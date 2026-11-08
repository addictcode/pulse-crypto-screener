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
import dev.pulse.signal.SignalTextRu;
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
            new TelegramApi.Command("digest", "The last 24 hours: sharpest moves, liquidations, walls"),
            new TelegramApi.Command("alerts", "Your price alerts; set one with /alert BTC 85000"),
            new TelegramApi.Command("mute", "Pause signals: /mute 1h, /mute off"),
            new TelegramApi.Command("watchlist", "Your watchlist"),
            new TelegramApi.Command("lang", "Language: /lang en, /lang ru"),
            new TelegramApi.Command("invite", "A link to bring a friend"),
            new TelegramApi.Command("help", "All commands"),
            new TelegramApi.Command("stop", "Stop signals; /start brings them back"));

    /** The menu, with /premium only while premium is on sale. */
    static List<TelegramApi.Command> menu(boolean premium) {
        if (!premium) {
            return MENU;
        }
        List<TelegramApi.Command> withPremium = new java.util.ArrayList<>(MENU);
        withPremium.add(withPremium.size() - 2, new TelegramApi.Command("premium", "Premium in Telegram Stars"));
        return List.copyOf(withPremium);
    }

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
        return handle(userId, text, false);
    }

    /** @param ru the sender's Telegram is in Russian: /help answers in Russian */
    String handle(long userId, String text, boolean ru) {
        String[] parts = text.trim().split("\\s+");
        // "/mute@PulseBot 1h" in group chats carries the bot name
        String command = parts[0].toLowerCase(Locale.ROOT).replaceFirst("@.*$", "");
        String arg1 = parts.length > 1 ? parts[1] : null;
        String arg2 = parts.length > 2 ? parts[2] : null;
        try {
            return switch (command) {
                case "/help" -> help(ru);
                case "/status" -> status(userId, ru);
                case "/signals" -> signals(userId, ru);
                case "/on" -> toggle(userId, arg1, true, ru);
                case "/off" -> toggle(userId, arg1, false, ru);
                case "/threshold" -> threshold(userId, arg1, arg2, ru);
                case "/mute" -> mute(userId, arg1, ru);
                case "/watch" -> watch(userId, arg1, ru);
                case "/unwatch" -> unwatch(userId, arg1, ru);
                case "/watchlist" -> watchlist(userId, ru);
                case "/scope" -> scope(userId, arg1, ru);
                case "/last" -> last(arg1, ru);
                case "/stats" -> stats(arg1, ru);
                case "/alert" -> alert(userId, arg1, arg2, ru);
                case "/alerts" -> alerts(userId, ru);
                case "/unalert" -> unalert(userId, arg1, ru);
                default -> w(ru, "Unknown command. /help lists what I understand.", "Не знаю такой команды. /help — что я понимаю.");
            };
        } catch (IllegalArgumentException e) {
            return escape(e.getMessage());
        }
    }

    /** The first message after /start. */
    static String welcome() {
        return welcome(false);
    }

    /** The first message after /start, in Russian when {@code ru}. */
    static String welcome(boolean ru) {
        if (ru) {
            return """
                    <b>Pulse</b> следит за всеми USDT-фьючерсами Binance и пишет в ту же минуту, когда что-то \
                    происходит: памп или дамп, всплеск объёма, скачок открытого интереса, ликвидации, крайний \
                    фандинг, цена у крупной стены в стакане. Ты видишь это сразу, раньше, чем заметил бы сам.

                    Pulse показывает, что делает рынок, а не куда он пойдёт: честная статистика — в /stats.

                    Сигналы уже идут — для начала спокойно: только сильные пампы, дампы и ликвидации. Настрой их под себя:
                    /signals — какие типы получать и с какого размера, кнопками
                    /watch WIF и /scope watchlist — только твои пары
                    /alert BTC 85000 — разовый ценовой алерт
                    /stats — что делала цена после каждого вида сигнала
                    /stop — пауза для всего

                    <i>Рыночные данные, не прогноз и не финансовый совет.</i>""";
        }
        return """
                <b>Pulse</b> watches every Binance USDT perpetual and tells you the moment something happens: \
                a pump or dump, a volume spike, open interest jumping, liquidations, extreme funding, \
                the price reaching a big order book wall. You see it as it happens, before you would notice it yourself.

                Pulse shows what the market is doing, not where it goes next: /stats has the honest record.

                Signals start now, calm to begin with: only strong pumps, dumps and liquidations. Make them yours:
                /signals - which types you get and from what size, with buttons
                /watch WIF and /scope watchlist - only your pairs
                /alert BTC 85000 - a one-off price alert
                /stats - what the price did after each kind of signal
                /stop - pause everything

                <i>Market data, not a forecast and not financial advice.</i>""";
    }

    static String help(boolean ru) {
        if (ru) {
            return """
                    <b>Pulse</b> показывает, что происходит на фьючерсах Binance, в момент, когда это происходит. \
                    Куда пойдёт цена, он не предсказывает.

                    /signals — типы сигналов, вкл/выкл и пороги
                    /on <i>тип</i>, /off <i>тип</i> — например, /off funding, /on all
                    /threshold <i>тип значение</i> — например, /threshold pump 3, /threshold pump default
                    /mute <i>30m | 2h | 1d | off</i> — пауза
                    /watch <i>тикер</i>, /unwatch <i>тикер</i>, /watchlist
                    /scope <i>all | watchlist</i> — по каким парам присылать сигналы
                    /alert <i>тикер цена</i> — сообщить один раз, когда цена дойдёт, например /alert BTC 85000
                    /alerts, /unalert <i>номер | тикер</i> — твои ценовые алерты
                    /last <i>[n]</i> — последние сигналы
                    /stats <i>[дни]</i> — что делала цена после каждого вида сигнала
                    /status — что скринер видит прямо сейчас
                    /digest — сутки: самые резкие движения, ликвидации, стены
                    /weekly <i>on | off</i> — итог недели по избранному по понедельникам
                    /lang <i>ru | en</i> — язык бота
                    /invite — ссылка, чтобы позвать друга
                    /stop, /start — пауза и возобновление

                    <i>Рыночные данные, не прогноз и не финансовый совет.</i>""";
        }
        return """
                <b>Pulse</b> shows what is happening on Binance futures as it happens. \
                It does not predict where the price goes.

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
                /status - what the screener sees right now
                /digest - the last 24 hours: sharpest moves, liquidations, largest walls
                /weekly <i>on | off</i> - a summary of your watchlist's week, on Mondays
                /lang <i>en | ru</i> - the bot's language
                /invite - a link to bring a friend
                /stop, /start - pause and resume signals

                <i>Market data, not a forecast and not financial advice.</i>""";
    }

    /** English or Russian, whichever the person reads. */
    static String w(boolean ru, String en, String russian) {
        return ru ? russian : en;
    }

    private String status(long userId, boolean ru) {
        DeliverySettings settings = accounts.settings(userId);
        long lastHour = history.countSince(Instant.now().minus(Duration.ofHours(1)));
        String delivery;
        if (settings.mutedUntil() != null && Instant.now().isBefore(settings.mutedUntil())) {
            delivery = w(ru, "muted until ", "пауза до ") + CLOCK.format(settings.mutedUntil()) + " UTC";
        } else {
            delivery = settings.watchlistOnly()
                    ? w(ru, "on, watchlist only (" + settings.watchlist().size() + " symbols)", "включены, только избранное (пар: " + settings.watchlist().size() + ")")
                    : w(ru, "on, all symbols", "включены, все пары");
        }
        return w(ru, "<b>Status</b>\n", "<b>Состояние</b>\n")
                + w(ru, "Market: " + market.symbols().size() + " pairs live\n", "Рынок: пар в работе — " + market.symbols().size() + "\n")
                + w(ru, "Order books: " + books.syncedCount() + " of " + books.tracked().size() + " in sync, ",
                        "Стаканы: синхронизировано " + books.syncedCount() + " из " + books.tracked().size() + ", ")
                + density.latest().walls().size() + w(ru, " walls\n", " стен\n")
                + w(ru, "Signals in the last hour: ", "Сигналов за час: ") + lastHour + "\n"
                + w(ru, "Delivery: ", "Доставка: ") + delivery;
    }

    private String signals(long userId, boolean ru) {
        DeliverySettings settings = accounts.settings(userId);
        StringBuilder text = new StringBuilder(w(ru, "<b>Signals</b>\n<pre>", "<b>Сигналы</b>\n<pre>"));
        for (SignalType type : SignalType.values()) {
            boolean on = !settings.disabled().contains(type);
            double threshold = settings.thresholdFor(type);
            String sign = type.higherIsStronger() ? "≥" : "≤";
            text.append(String.format(Locale.US, "%-4s %-8s %s %s%s%n",
                    on ? w(ru, "on", "вкл") : w(ru, "off", "выкл"), type.key(), sign, formatThreshold(type, threshold),
                    threshold == type.floor() ? "" : w(ru, " (custom)", " (свой)")));
        }
        text.append(w(ru, "</pre>Types: ", "</pre>Типы: "));
        text.append(String.join(", ", Arrays.stream(SignalType.values()).map(t -> t.key() + " = " + (ru ? Presets.descriptionRu(t) : t.description())).toList()));
        return text.append(w(ru, "\n\nA preset sets them all at once:", "\n\nПресет настроит всё разом:")).toString();
    }

    private String toggle(long userId, String arg, boolean enabled, boolean ru) {
        if (arg == null) {
            throw new IllegalArgumentException(w(ru, "Which type? e.g. /" + (enabled ? "on" : "off") + " pump, or all.",
                    "Какой тип? Например, /" + (enabled ? "on" : "off") + " pump, или all."));
        }
        if (arg.equalsIgnoreCase("all")) {
            for (SignalType type : SignalType.values()) {
                accounts.setEnabled(userId, type, enabled);
            }
            return w(ru, "All signal types " + (enabled ? "on." : "off."), "Все типы сигналов " + (enabled ? "включены." : "выключены."));
        }
        SignalType type = type(arg, ru);
        accounts.setEnabled(userId, type, enabled);
        return w(ru, type.label() + " signals " + (enabled ? "on." : "off."), Presets.labelRu(type) + ": " + (enabled ? "включены." : "выключены."));
    }

    private String threshold(long userId, String typeArg, String valueArg, boolean ru) {
        if (typeArg == null || valueArg == null) {
            throw new IllegalArgumentException(w(ru, "Usage: /threshold pump 3, or /threshold pump default.", "Так: /threshold pump 3 или /threshold pump default."));
        }
        SignalType type = type(typeArg, ru);
        String label = ru ? Presets.labelRu(type) : type.label();
        if (valueArg.equalsIgnoreCase("default")) {
            accounts.setThreshold(userId, type, null);
            return w(ru, label + " back to the default " + formatThreshold(type, type.floor()) + ".",
                    label + ": снова порог по умолчанию, " + formatThreshold(type, type.floor()) + ".");
        }
        double value;
        try {
            value = Double.parseDouble(valueArg.replace(",", ".").replace("%", "").replace("$", "").replace("x", ""));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(w(ru, "\"" + valueArg + "\" is not a number.", "«" + valueArg + "» — не число."));
        }
        if (!type.isAllowedThreshold(value)) {
            String limit = type.higherIsStronger() ? w(ru, "lower than", "ниже") : w(ru, "higher than", "выше");
            throw new IllegalArgumentException(w(ru, label + " cannot go " + limit + " " + formatThreshold(type, type.floor()) + ": the detector does not look below that.",
                    label + ": порог не может быть " + limit + " " + formatThreshold(type, type.floor()) + " — детектор ниже не смотрит."));
        }
        accounts.setThreshold(userId, type, value);
        return w(ru, label + " threshold set to " + formatThreshold(type, value) + ".", label + ": порог " + formatThreshold(type, value) + ".");
    }

    String mute(long userId, String arg, boolean ru) {
        if (arg == null) {
            throw new IllegalArgumentException(w(ru, "For how long? e.g. /mute 30m, /mute 2h, /mute off.", "На сколько? Например, /mute 30m, /mute 2h, /mute off."));
        }
        if (arg.equalsIgnoreCase("off")) {
            accounts.mute(userId, null);
            return w(ru, "Unmuted. Signals are back on.", "Пауза снята, сигналы снова идут.");
        }
        Matcher m = DURATION.matcher(arg.toLowerCase(Locale.ROOT));
        if (!m.matches()) {
            throw new IllegalArgumentException(w(ru, "Use minutes, hours or days: 30m, 2h, 1d.", "Минуты, часы или дни: 30m, 2h, 1d."));
        }
        long amount = Long.parseLong(m.group(1));
        Duration duration = switch (m.group(2)) {
            case "m" -> Duration.ofMinutes(amount);
            case "h" -> Duration.ofHours(amount);
            default -> Duration.ofDays(amount);
        };
        Instant until = accounts.mute(userId, duration);
        return w(ru, "Muted until " + CLOCK.format(until) + " UTC. /mute off to resume earlier.",
                "Пауза до " + CLOCK.format(until) + " UTC. /mute off — снять раньше.");
    }

    private String watch(long userId, String arg, boolean ru) {
        String symbol = symbol(arg, ru);
        return accounts.watch(userId, symbol)
                ? w(ru, Text.base(symbol) + " added to your watchlist.", Text.base(symbol) + " — в избранном.")
                : w(ru, Text.base(symbol) + " is already on your watchlist.", Text.base(symbol) + " уже в избранном.");
    }

    private String unwatch(long userId, String arg, boolean ru) {
        String symbol = symbol(arg, ru);
        return accounts.unwatch(userId, symbol)
                ? w(ru, Text.base(symbol) + " removed from your watchlist.", Text.base(symbol) + " убрана из избранного.")
                : w(ru, Text.base(symbol) + " was not on your watchlist.", Text.base(symbol) + " не было в избранном.");
    }

    private String watchlist(long userId, boolean ru) {
        DeliverySettings settings = accounts.settings(userId);
        if (settings.watchlist().isEmpty()) {
            return w(ru, "Your watchlist is empty. /watch WIF adds a pair.", "Избранное пустое. /watch WIF добавит пару.");
        }
        return w(ru, "<b>Watchlist</b>\n", "<b>Избранное</b>\n") + String.join(", ", settings.watchlist().stream().map(Text::base).toList())
                + (settings.watchlistOnly() ? w(ru, "\nYou get signals only for these.", "\nСигналы приходят только по ним.")
                        : w(ru, "\nYou get signals for all pairs; /scope watchlist narrows it.", "\nСигналы приходят по всем парам; /scope watchlist — только по этим."));
    }

    private String scope(long userId, String arg, boolean ru) {
        if ("all".equalsIgnoreCase(arg)) {
            accounts.setWatchlistOnly(userId, false);
            return w(ru, "Signals for all pairs.", "Сигналы по всем парам.");
        }
        if ("watchlist".equalsIgnoreCase(arg)) {
            accounts.setWatchlistOnly(userId, true);
            int n = accounts.settings(userId).watchlist().size();
            return w(ru, "Signals only for your watchlist (" + n + " pairs).", "Сигналы только по избранному (пар: " + n + ").");
        }
        throw new IllegalArgumentException(w(ru, "Use /scope all or /scope watchlist.", "Так: /scope all или /scope watchlist."));
    }

    private String last(String arg, boolean ru) {
        int count = LAST_DEFAULT;
        if (arg != null) {
            try {
                count = Math.max(1, Math.min(LAST_MAX, Integer.parseInt(arg)));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException(w(ru, "Use a number, e.g. /last 10.", "Нужно число, например /last 10."));
            }
        }
        List<Signal> signals = history.recent(count);
        if (signals.isEmpty()) {
            return w(ru, "No signals yet.", "Сигналов пока нет.");
        }
        StringBuilder text = new StringBuilder(w(ru, "<b>Latest signals</b>\n", "<b>Последние сигналы</b>\n"));
        for (Signal s : signals) {
            text.append('\n').append(CLOCK.format(Instant.ofEpochMilli(s.time()))).append("  ").append(escape(ru ? SignalTextRu.title(s) : s.title()));
        }
        return text.toString();
    }

    private String alert(long userId, String symbolArg, String levelArg, boolean ru) {
        if (symbolArg == null || levelArg == null) {
            throw new IllegalArgumentException(w(ru, "Usage: /alert BTC 85000.", "Так: /alert BTC 85000."));
        }
        String symbol = symbol(symbolArg, ru);
        Double price = market.price(symbol);
        if (price == null) {
            throw new IllegalArgumentException(w(ru, "No live price for " + Text.base(symbol) + " yet, try again in a moment.",
                    "Живой цены " + Text.base(symbol) + " пока нет, попробуй через минуту."));
        }
        PriceAlert created = alerts.create(userId, symbol, number(levelArg, ru), price);
        double away = (created.level() / price - 1) * 100;
        return w(ru, "Alert set: " + describe(created) + ".\nNow " + Text.price(price) + ", " + Text.pct(away, 2) + " away.",
                "Алерт поставлен: " + describe(created, true) + ".\nСейчас " + Text.price(price) + ", до уровня " + Text.pct(away, 2) + ".");
    }

    private String alerts(long userId, boolean ru) {
        List<PriceAlert> waiting = alerts.waitingFor(userId);
        if (waiting.isEmpty()) {
            return w(ru, "No price alerts. /alert BTC 85000 sets one.", "Ценовых алертов нет. /alert BTC 85000 поставит.");
        }
        StringBuilder text = new StringBuilder(w(ru, "<b>Price alerts</b>\n<pre>", "<b>Ценовые алерты</b>\n<pre>"));
        for (PriceAlert a : waiting) {
            Double price = market.price(a.symbol());
            String away = price == null ? "" : Text.pct((a.level() / price - 1) * 100, 2);
            text.append(String.format(Locale.US, "%-4d %-9s %-5s %12s %8s%n",
                    a.id(), Text.base(a.symbol()), a.above() ? w(ru, "above", "выше") : w(ru, "below", "ниже"), Text.price(a.level()), away));
        }
        return text.append(w(ru, "</pre>/unalert <i>number</i> removes one, /unalert <i>symbol</i> all for a pair.",
                "</pre>/unalert <i>номер</i> убирает один, /unalert <i>тикер</i> — все по паре.")).toString();
    }

    private String unalert(long userId, String arg, boolean ru) {
        if (arg == null) {
            throw new IllegalArgumentException(w(ru, "Which one? /unalert 12 by number, or /unalert BTC for a whole pair. /alerts lists them.",
                    "Какой? /unalert 12 по номеру или /unalert BTC для всей пары. Список — /alerts."));
        }
        if (arg.chars().allMatch(Character::isDigit)) {
            return alerts.remove(userId, Long.parseLong(arg))
                    ? w(ru, "Alert " + arg + " removed.", "Алерт " + arg + " убран.")
                    : w(ru, "No alert number " + arg + ". /alerts lists them.", "Алерта с номером " + arg + " нет. Список — /alerts.");
        }
        String symbol = symbol(arg, ru);
        int removed = alerts.removeFor(userId, symbol);
        if (removed == 0) {
            return w(ru, "No alerts on " + Text.base(symbol) + ".", "По " + Text.base(symbol) + " алертов нет.");
        }
        return w(ru, removed + (removed == 1 ? " alert" : " alerts") + " on " + Text.base(symbol) + " removed.",
                "Убрано алертов по " + Text.base(symbol) + ": " + removed + ".");
    }

    static String describe(PriceAlert alert) {
        return describe(alert, false);
    }

    static String describe(PriceAlert alert, boolean ru) {
        return Text.base(alert.symbol()) + (alert.above() ? w(ru, " above ", " выше ") : w(ru, " below ", " ниже ")) + Text.price(alert.level());
    }

    private static double number(String arg, boolean ru) {
        try {
            return Double.parseDouble(arg.replace(",", "").replace("$", "").replace("_", ""));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(w(ru, "\"" + arg + "\" is not a price.", "«" + arg + "» — не цена."));
        }
    }

    private String stats(String arg, boolean ru) {
        int days = STATS_DEFAULT_DAYS;
        if (arg != null) {
            try {
                days = Math.max(1, Math.min(STATS_MAX_DAYS, Integer.parseInt(arg.toLowerCase(Locale.ROOT).replace("d", ""))));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException(w(ru, "Use a number of days, e.g. /stats 30.", "Нужно число дней, например /stats 30."));
            }
        }
        List<OutcomeStats> stats = history.outcomes(Instant.now().minus(Duration.ofDays(days))).stream()
                .filter(s -> s.measured() > 0)
                .toList();
        if (stats.isEmpty()) {
            return w(ru, "No measured signals in the last " + days + " d yet. Outcomes are taken 5 minutes, 15 minutes and an hour after each signal.",
                    "За последние дни (" + days + ") измеренных сигналов пока нет. Исход берётся через 5 минут, 15 минут и час после сигнала.");
        }
        StringBuilder text = new StringBuilder(w(ru, "<b>After the signal</b>, last " + days + " d\n<pre>", "<b>После сигнала</b>, дней: " + days + "\n<pre>"));
        text.append(String.format(Locale.US, "%-19s %4s %7s %7s %7s%n", "", "n", "5m", "15m", "1h"));
        for (OutcomeStats s : stats) {
            text.append(String.format(Locale.US, "%-19s %4d", s.label(), s.measured()));
            for (OutcomeStats.Cell cell : s.horizons()) {
                text.append(String.format(Locale.US, " %7s", cell.avg() == null ? "–" : Text.pct(cell.avg(), 2)));
            }
            text.append('\n');
        }
        return text.append(w(ru, "</pre>Average price change after the signal fired.", "</pre>Среднее изменение цены после сигнала.")).toString();
    }

    private SignalType type(String arg, boolean ru) {
        Optional<SignalType> type = SignalType.fromKey(arg);
        String keys = String.join(", ", Arrays.stream(SignalType.values()).map(SignalType::key).toList());
        return type.orElseThrow(() -> new IllegalArgumentException(w(ru, "Unknown type \"" + arg + "\". Types: " + keys + ".",
                "Нет такого типа «" + arg + "». Типы: " + keys + ".")));
    }

    /** "wif", "WIF/USDT" and "WIFUSDT" all mean WIFUSDT. */
    private String symbol(String arg, boolean ru) {
        if (arg == null) {
            throw new IllegalArgumentException(w(ru, "Which pair? e.g. /watch WIF.", "Какая пара? Например, /watch WIF."));
        }
        String symbol = arg.toUpperCase(Locale.ROOT).replace("/", "").replace("-", "");
        if (!symbol.endsWith("USDT")) {
            symbol += "USDT";
        }
        if (!market.isListed(symbol)) {
            throw new IllegalArgumentException(w(ru, Text.base(symbol) + " is not a Binance USDT perpetual.", Text.base(symbol) + " — не бессрочный USDT-фьючерс Binance."));
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
