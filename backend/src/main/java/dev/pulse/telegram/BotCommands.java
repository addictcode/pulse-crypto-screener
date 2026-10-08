package dev.pulse.telegram;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import dev.pulse.account.AccountService;
import dev.pulse.account.DeliverySettings;
import dev.pulse.alert.AlertService;
import dev.pulse.alert.PriceAlert;
import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.OrderBookStore;
import dev.pulse.market.MarketStore;
import dev.pulse.signal.OutcomeStats;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.SignalType;
import dev.pulse.signal.Text;

import static dev.pulse.telegram.TelegramFormat.CLOCK;
import static dev.pulse.telegram.TelegramFormat.escape;

/**
 * Text commands of the bot. Takes a user id and the raw message, returns the reply as Telegram
 * HTML; it never talks to Telegram itself, which keeps it easy to test.
 */
final class BotCommands {

    static final List<TelegramApi.Command> MENU = List.of(
            new TelegramApi.Command("signals", "Signal types, on/off and thresholds"),
            new TelegramApi.Command("last", "Latest signals"),
            new TelegramApi.Command("stats", "What the price did after each kind of signal"),
            new TelegramApi.Command("status", "What the screener sees right now"),
            new TelegramApi.Command("alerts", "Your price alerts; set one with /alert BTC 85000"),
            new TelegramApi.Command("mute", "Pause signals: /mute 1h, /mute off"),
            new TelegramApi.Command("watchlist", "Your watchlist"),
            new TelegramApi.Command("help", "All commands"));

    private static final Pattern DURATION = Pattern.compile("(\\d{1,3})\\s*([mhd])");
    private static final int LAST_DEFAULT = 5;
    private static final int LAST_MAX = 15;
    private static final int STATS_DEFAULT_DAYS = 7;
    private static final int STATS_MAX_DAYS = 90;

    private final AccountService accounts;
    private final SignalHistory history;
    private final MarketStore market;
    private final OrderBookStore books;
    private final DensityScanner density;
    private final AlertService alerts;

    BotCommands(AccountService accounts, SignalHistory history, MarketStore market, OrderBookStore books, DensityScanner density,
                AlertService alerts) {
        this.alerts = alerts;
        this.accounts = accounts;
        this.history = history;
        this.market = market;
        this.books = books;
        this.density = density;
    }

    String handle(long userId, String text) {
        String[] parts = text.trim().split("\\s+");
        // "/mute@PulseBot 1h" in group chats carries the bot name
        String command = parts[0].toLowerCase(Locale.ROOT).replaceFirst("@.*$", "");
        String arg1 = parts.length > 1 ? parts[1] : null;
        String arg2 = parts.length > 2 ? parts[2] : null;
        try {
            return switch (command) {
                case "/start", "/help" -> help();
                case "/status" -> status(userId);
                case "/signals" -> signals(userId);
                case "/on" -> toggle(userId, arg1, true);
                case "/off" -> toggle(userId, arg1, false);
                case "/threshold" -> threshold(userId, arg1, arg2);
                case "/mute" -> mute(userId, arg1);
                case "/watch" -> watch(userId, arg1);
                case "/unwatch" -> unwatch(userId, arg1);
                case "/watchlist" -> watchlist(userId);
                case "/scope" -> scope(userId, arg1);
                case "/last" -> last(arg1);
                case "/stats" -> stats(arg1);
                case "/alert" -> alert(userId, arg1, arg2);
                case "/alerts" -> alerts(userId);
                case "/unalert" -> unalert(userId, arg1);
                default -> "Unknown command. /help lists what I understand.";
            };
        } catch (IllegalArgumentException e) {
            return escape(e.getMessage());
        }
    }

    private String help() {
        return """
                <b>Pulse</b> sends you market signals from Binance futures.

                /signals - signal types, on/off and thresholds
                /on <i>type</i>, /off <i>type</i> - e.g. /off funding, /on all
                /threshold <i>type value</i> - e.g. /threshold pump 3, /threshold pump default
                /mute <i>30m | 2h | 1d | off</i> - pause delivery
                /watch <i>symbol</i>, /unwatch <i>symbol</i>, /watchlist
                /scope <i>all | watchlist</i> - which symbols you get signals for
                /alert <i>symbol price</i> - tell me once when the price gets there, e.g. /alert BTC 85000
                /alerts, /unalert <i>number | symbol</i> - your price alerts
                /last <i>[n]</i> - latest signals
                /stats <i>[days]</i> - what the price did after each kind of signal
                /status - what the screener sees right now""";
    }

    private String status(long userId) {
        DeliverySettings settings = accounts.settings(userId);
        long lastHour = history.countSince(Instant.now().minus(Duration.ofHours(1)));
        String delivery;
        if (settings.mutedUntil() != null && Instant.now().isBefore(settings.mutedUntil())) {
            delivery = "muted until " + CLOCK.format(settings.mutedUntil()) + " UTC";
        } else {
            delivery = settings.watchlistOnly() ? "on, watchlist only (" + settings.watchlist().size() + " symbols)" : "on, all symbols";
        }
        return "<b>Status</b>\n"
                + "Market: " + market.symbols().size() + " pairs live\n"
                + "Order books: " + books.syncedCount() + " of " + books.tracked().size() + " in sync, "
                + density.latest().walls().size() + " walls\n"
                + "Signals in the last hour: " + lastHour + "\n"
                + "Delivery: " + delivery;
    }

    private String signals(long userId) {
        DeliverySettings settings = accounts.settings(userId);
        StringBuilder text = new StringBuilder("<b>Signals</b>\n<pre>");
        for (SignalType type : SignalType.values()) {
            boolean on = !settings.disabled().contains(type);
            double threshold = settings.thresholdFor(type);
            String sign = type.higherIsStronger() ? "≥" : "≤";
            text.append(String.format(Locale.US, "%-4s %-8s %s %s%s%n",
                    on ? "on" : "off", type.key(), sign, formatThreshold(type, threshold),
                    threshold == type.floor() ? "" : " (custom)"));
        }
        text.append("</pre>Types: ");
        text.append(String.join(", ", Arrays.stream(SignalType.values()).map(t -> t.key() + " = " + t.description()).toList()));
        return text.toString();
    }

    private String toggle(long userId, String arg, boolean enabled) {
        if (arg == null) {
            throw new IllegalArgumentException("Which type? e.g. /" + (enabled ? "on" : "off") + " pump, or all.");
        }
        if (arg.equalsIgnoreCase("all")) {
            for (SignalType type : SignalType.values()) {
                accounts.setEnabled(userId, type, enabled);
            }
            return "All signal types " + (enabled ? "on." : "off.");
        }
        SignalType type = type(arg);
        accounts.setEnabled(userId, type, enabled);
        return type.label() + " signals " + (enabled ? "on." : "off.");
    }

    private String threshold(long userId, String typeArg, String valueArg) {
        if (typeArg == null || valueArg == null) {
            throw new IllegalArgumentException("Usage: /threshold pump 3, or /threshold pump default.");
        }
        SignalType type = type(typeArg);
        if (valueArg.equalsIgnoreCase("default")) {
            accounts.setThreshold(userId, type, null);
            return type.label() + " back to the default " + formatThreshold(type, type.floor()) + ".";
        }
        double value;
        try {
            value = Double.parseDouble(valueArg.replace(",", ".").replace("%", "").replace("$", "").replace("x", ""));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("\"" + valueArg + "\" is not a number.");
        }
        if (!type.isAllowedThreshold(value)) {
            String limit = type.higherIsStronger() ? "lower than" : "higher than";
            throw new IllegalArgumentException(type.label() + " cannot go " + limit + " " + formatThreshold(type, type.floor())
                    + ": the detector does not look below that.");
        }
        accounts.setThreshold(userId, type, value);
        return type.label() + " threshold set to " + formatThreshold(type, value) + ".";
    }

    private String mute(long userId, String arg) {
        if (arg == null) {
            throw new IllegalArgumentException("For how long? e.g. /mute 30m, /mute 2h, /mute off.");
        }
        if (arg.equalsIgnoreCase("off")) {
            accounts.mute(userId, null);
            return "Unmuted. Signals are back on.";
        }
        Matcher m = DURATION.matcher(arg.toLowerCase(Locale.ROOT));
        if (!m.matches()) {
            throw new IllegalArgumentException("Use minutes, hours or days: 30m, 2h, 1d.");
        }
        long amount = Long.parseLong(m.group(1));
        Duration duration = switch (m.group(2)) {
            case "m" -> Duration.ofMinutes(amount);
            case "h" -> Duration.ofHours(amount);
            default -> Duration.ofDays(amount);
        };
        Instant until = accounts.mute(userId, duration);
        return "Muted until " + CLOCK.format(until) + " UTC. /mute off to resume earlier.";
    }

    private String watch(long userId, String arg) {
        String symbol = symbol(arg);
        return accounts.watch(userId, symbol)
                ? Text.base(symbol) + " added to your watchlist."
                : Text.base(symbol) + " is already on your watchlist.";
    }

    private String unwatch(long userId, String arg) {
        String symbol = symbol(arg);
        return accounts.unwatch(userId, symbol)
                ? Text.base(symbol) + " removed from your watchlist."
                : Text.base(symbol) + " was not on your watchlist.";
    }

    private String watchlist(long userId) {
        DeliverySettings settings = accounts.settings(userId);
        if (settings.watchlist().isEmpty()) {
            return "Your watchlist is empty. /watch WIF adds a pair.";
        }
        return "<b>Watchlist</b>\n" + String.join(", ", settings.watchlist().stream().map(Text::base).toList())
                + (settings.watchlistOnly() ? "\nYou get signals only for these." : "\nYou get signals for all pairs; /scope watchlist narrows it.");
    }

    private String scope(long userId, String arg) {
        if ("all".equalsIgnoreCase(arg)) {
            accounts.setWatchlistOnly(userId, false);
            return "Signals for all pairs.";
        }
        if ("watchlist".equalsIgnoreCase(arg)) {
            accounts.setWatchlistOnly(userId, true);
            return "Signals only for your watchlist (" + accounts.settings(userId).watchlist().size() + " pairs).";
        }
        throw new IllegalArgumentException("Use /scope all or /scope watchlist.");
    }

    private String last(String arg) {
        int count = LAST_DEFAULT;
        if (arg != null) {
            try {
                count = Math.max(1, Math.min(LAST_MAX, Integer.parseInt(arg)));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("Use a number, e.g. /last 10.");
            }
        }
        List<Signal> signals = history.recent(count);
        if (signals.isEmpty()) {
            return "No signals yet.";
        }
        StringBuilder text = new StringBuilder("<b>Latest signals</b>\n");
        for (Signal s : signals) {
            text.append('\n').append(CLOCK.format(Instant.ofEpochMilli(s.time()))).append("  ").append(escape(s.title()));
        }
        return text.toString();
    }

    private String alert(long userId, String symbolArg, String levelArg) {
        if (symbolArg == null || levelArg == null) {
            throw new IllegalArgumentException("Usage: /alert BTC 85000.");
        }
        String symbol = symbol(symbolArg);
        Double price = market.price(symbol);
        if (price == null) {
            throw new IllegalArgumentException("No live price for " + Text.base(symbol) + " yet, try again in a moment.");
        }
        PriceAlert created = alerts.create(userId, symbol, number(levelArg), price);
        double away = (created.level() / price - 1) * 100;
        return "Alert set: " + describe(created) + ".\nNow " + Text.price(price) + ", " + Text.pct(away, 2) + " away.";
    }

    private String alerts(long userId) {
        List<PriceAlert> waiting = alerts.waitingFor(userId);
        if (waiting.isEmpty()) {
            return "No price alerts. /alert BTC 85000 sets one.";
        }
        StringBuilder text = new StringBuilder("<b>Price alerts</b>\n<pre>");
        for (PriceAlert a : waiting) {
            Double price = market.price(a.symbol());
            String away = price == null ? "" : Text.pct((a.level() / price - 1) * 100, 2);
            text.append(String.format(Locale.US, "%-4d %-9s %-5s %12s %8s%n",
                    a.id(), Text.base(a.symbol()), a.above() ? "above" : "below", Text.price(a.level()), away));
        }
        return text.append("</pre>/unalert <i>number</i> removes one, /unalert <i>symbol</i> all for a pair.").toString();
    }

    private String unalert(long userId, String arg) {
        if (arg == null) {
            throw new IllegalArgumentException("Which one? /unalert 12 by number, or /unalert BTC for a whole pair. /alerts lists them.");
        }
        if (arg.chars().allMatch(Character::isDigit)) {
            return alerts.remove(userId, Long.parseLong(arg)) ? "Alert " + arg + " removed." : "No alert number " + arg + ". /alerts lists them.";
        }
        String symbol = symbol(arg);
        int removed = alerts.removeFor(userId, symbol);
        return removed == 0 ? "No alerts on " + Text.base(symbol) + "." : removed + (removed == 1 ? " alert" : " alerts") + " on " + Text.base(symbol) + " removed.";
    }

    static String describe(PriceAlert alert) {
        return Text.base(alert.symbol()) + (alert.above() ? " above " : " below ") + Text.price(alert.level());
    }

    private static double number(String arg) {
        try {
            return Double.parseDouble(arg.replace(",", "").replace("$", "").replace("_", ""));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("\"" + arg + "\" is not a price.");
        }
    }

    private String stats(String arg) {
        int days = STATS_DEFAULT_DAYS;
        if (arg != null) {
            try {
                days = Math.max(1, Math.min(STATS_MAX_DAYS, Integer.parseInt(arg.toLowerCase(Locale.ROOT).replace("d", ""))));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("Use a number of days, e.g. /stats 30.");
            }
        }
        List<OutcomeStats> stats = history.outcomes(Instant.now().minus(Duration.ofDays(days))).stream()
                .filter(s -> s.measured() > 0)
                .toList();
        if (stats.isEmpty()) {
            return "No measured signals in the last " + days + " d yet. Outcomes are taken 5 minutes, 15 minutes and an hour after each signal.";
        }
        StringBuilder text = new StringBuilder("<b>After the signal</b>, last " + days + " d\n<pre>");
        text.append(String.format(Locale.US, "%-19s %4s %7s %7s %7s%n", "", "n", "5m", "15m", "1h"));
        for (OutcomeStats s : stats) {
            text.append(String.format(Locale.US, "%-19s %4d", s.label(), s.measured()));
            for (OutcomeStats.Cell cell : s.horizons()) {
                text.append(String.format(Locale.US, " %7s", cell.avg() == null ? "–" : Text.pct(cell.avg(), 2)));
            }
            text.append('\n');
        }
        return text.append("</pre>Average price change after the signal fired.").toString();
    }

    private SignalType type(String arg) {
        Optional<SignalType> type = SignalType.fromKey(arg);
        return type.orElseThrow(() -> new IllegalArgumentException("Unknown type \"" + arg + "\". Types: "
                + String.join(", ", Arrays.stream(SignalType.values()).map(SignalType::key).toList()) + "."));
    }

    /** "wif", "WIF/USDT" and "WIFUSDT" all mean WIFUSDT. */
    private String symbol(String arg) {
        if (arg == null) {
            throw new IllegalArgumentException("Which pair? e.g. /watch WIF.");
        }
        String symbol = arg.toUpperCase(Locale.ROOT).replace("/", "").replace("-", "");
        if (!symbol.endsWith("USDT")) {
            symbol += "USDT";
        }
        if (!market.isListed(symbol)) {
            throw new IllegalArgumentException(Text.base(symbol) + " is not a Binance USDT perpetual.");
        }
        return symbol;
    }

    static String formatThreshold(SignalType type, double value) {
        return switch (type.unit()) {
            case "$" -> Text.usd(value);
            case "×" -> Text.num(value, 1) + "×";
            default -> Text.num(value, value < 1 ? 2 : 1) + "%";
        };
    }
}
