package dev.pulse.telegram;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;

import dev.pulse.alert.AlertFired;
import dev.pulse.alert.PriceAlert;
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

    static String alert(AlertFired fired) {
        PriceAlert a = fired.alert();
        return "<b>" + Text.base(a.symbol()) + (a.above() ? " rose to " : " fell to ") + Text.price(a.level()) + "</b>\n"
                + "Now " + Text.price(fired.price()) + ".\n"
                + "<i>Price alert, " + CLOCK.format(Instant.now()) + " UTC</i>";
    }

    static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
