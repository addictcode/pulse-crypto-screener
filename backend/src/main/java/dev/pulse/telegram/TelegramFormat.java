package dev.pulse.telegram;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import dev.pulse.alert.AlertFired;
import dev.pulse.alert.PriceAlert;
import dev.pulse.setup.SetupTrade;
import dev.pulse.signal.Signal;
import dev.pulse.signal.Text;

/**
 * Telegram HTML for signals. Titles carry the news, the second line the context,
 * a quiet footer says what kind of signal it was and when.
 */
final class TelegramFormat {

    static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneOffset.UTC);

    private TelegramFormat() {
    }

    static String signal(Signal s) {
        return "<b>" + escape(s.title()) + "</b>\n"
                + escape(s.detail()) + "\n"
                + "<i>" + s.type().label() + ", " + CLOCK.format(Instant.ofEpochMilli(s.time())) + " UTC</i>";
    }

    /** Several signals at once, e.g. during a market-wide move, as one message. */
    static String digest(List<Signal> signals) {
        StringBuilder text = new StringBuilder("<b>").append(signals.size()).append(" signals</b>\n");
        for (Signal s : signals) {
            text.append('\n').append(CLOCK.format(Instant.ofEpochMilli(s.time()))).append("  ").append(escape(s.title()));
        }
        return text.toString();
    }

    /**
     * A channel post: signals the bot sent a few minutes ago and how the price went since.
     *
     * @param prices current price by symbol; a symbol without one shows no follow-up
     * @param bot    the bot's username, without "@"; empty when unknown
     */
    static String channel(List<Signal> signals, Map<String, Double> prices, long delayMinutes, String bot) {
        StringBuilder text = new StringBuilder();
        if (signals.size() == 1) {
            Signal s = signals.getFirst();
            text.append("<b>").append(escape(s.title())).append("</b>\n")
                    .append(escape(s.detail())).append('\n');
            since(s, prices.get(s.symbol())).ifPresent(line -> text.append("Since then: ").append(line).append(".\n"));
            text.append("<i>").append(s.type().label()).append(", ").append(CLOCK.format(Instant.ofEpochMilli(s.time()))).append(" UTC</i>");
        } else {
            text.append("<b>").append(signals.size()).append(" signals</b>\n");
            for (Signal s : signals) {
                text.append('\n').append(CLOCK.format(Instant.ofEpochMilli(s.time()))).append("  ").append(escape(s.title()));
                since(s, prices.get(s.symbol())).ifPresent(line -> text.append(", since then ").append(line));
            }
        }
        text.append("\n\n");
        if (!bot.isEmpty()) {
            text.append("The bot sent this ").append(delayMinutes).append(" min earlier: @").append(bot).append('\n');
        }
        return text.append("<i>Market data, not financial advice.</i>").toString();
    }

    private static Optional<String> since(Signal s, Double now) {
        if (now == null || s.price() <= 0) {
            return Optional.empty();
        }
        return Optional.of(Text.pct((now / s.price() - 1) * 100, 2));
    }

    static String alert(AlertFired fired) {
        PriceAlert a = fired.alert();
        return "<b>" + Text.base(a.symbol()) + (a.above() ? " rose to " : " fell to ") + Text.price(a.level()) + "</b>\n"
                + "Now " + Text.price(fired.price()) + ".\n"
                + "<i>Price alert, " + CLOCK.format(Instant.now()) + " UTC</i>";
    }

    static String setupOpened(SetupTrade t) {
        return "<b>" + Text.base(t.symbol()) + " " + t.timeframe() + ": " + (t.direction() == 1 ? "long" : "short") + " setup</b>\n"
                + "Entry " + Text.price(t.entry()) + ", stop " + Text.price(t.stop()) + ", target " + Text.price(t.target()) + " (3R).\n"
                + "<i>Pulse Setups, " + CLOCK.format(t.openedAt()) + " UTC. Not advice.</i>";
    }

    static String setupClosed(SetupTrade t) {
        String how = switch (t.status()) {
            case WON -> "reached its target";
            case LOST -> "was stopped out";
            default -> "ran out of time";
        };
        return "<b>" + Text.base(t.symbol()) + " " + t.timeframe() + " " + (t.direction() == 1 ? "long" : "short") + " " + how + "</b>\n"
                + String.format(java.util.Locale.ROOT, "%+.2fR after fees.", t.resultR()) + "\n"
                + "<i>Pulse Setups, " + CLOCK.format(t.closedAt()) + " UTC</i>";
    }

    static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
