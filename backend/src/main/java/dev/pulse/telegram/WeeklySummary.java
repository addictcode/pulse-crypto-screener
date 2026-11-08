package dev.pulse.telegram;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;

import dev.pulse.signal.Signal;
import dev.pulse.signal.Text;

import static dev.pulse.telegram.TelegramFormat.escape;

/**
 * The Monday message to every subscriber: the sharpest moves of the week on their watchlist (or,
 * with an empty watchlist, on the whole market), each with what the price did an hour later.
 * A reason to open the bot again that is about their own pairs, not one more alert.
 */
final class WeeklySummary {

    static final long WEEK_MS = 7 * 24 * 3_600_000L;
    static final int MOVES = 5;
    private static final DateTimeFormatter EN = DateTimeFormatter.ofPattern("EEE HH:mm", Locale.ENGLISH).withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter RU = DateTimeFormatter.ofPattern("EEE HH:mm", Locale.forLanguageTag("ru")).withZone(ZoneOffset.UTC);

    private WeeklySummary() {
    }

    /** Mondays, in the configured hour (UTC); a negative hour turns it off. */
    static boolean due(int hour, ZonedDateTime now) {
        return hour >= 0 && now.getDayOfWeek() == DayOfWeek.MONDAY && now.getHour() == hour;
    }

    /** The moves of the week for one person: their pairs if they have any, else the whole market. */
    static List<Signal> moves(List<Signal> week, List<String> watchlist, long now) {
        List<Signal> mine = watchlist.isEmpty() ? week : week.stream().filter(s -> watchlist.contains(s.symbol())).toList();
        return DailyDigest.sharpest(mine, now, MOVES, WEEK_MS);
    }

    static String format(List<Signal> moves, boolean ownPairs, boolean ru) {
        StringBuilder text = new StringBuilder(ru ? "<b>Твоя неделя в Pulse</b>\n\n" : "<b>Your week on Pulse</b>\n\n");
        if (moves.isEmpty()) {
            text.append(ru ? "Тихая неделя: ни одного пампа или дампа больше порога" : "A quiet week: no pump or dump above the threshold")
                    .append(ownPairs ? (ru ? " по твоим парам." : " on your pairs.") : ".").append('\n');
        } else {
            text.append(ownPairs ? (ru ? "Самое резкое по твоему избранному:" : "The sharpest moves on your watchlist:")
                    : (ru ? "Самое резкое на всём рынке:" : "The sharpest moves on the whole market:")).append('\n');
            for (Signal s : moves) {
                text.append(escape(Text.base(s.symbol()))).append(' ').append(Text.pct(DailyDigest.move(s), 1))
                        .append(ru ? " за 5 мин, " : " in 5 min, ").append((ru ? RU : EN).format(Instant.ofEpochMilli(s.time()))).append(" UTC");
                if (s.ret1h() != null) {
                    text.append(ru ? "; через час " : "; an hour later ").append(Text.pct(s.ret1h(), 1));
                }
                text.append('\n');
            }
        }
        if (!ownPairs) {
            text.append('\n').append(ru ? "/watch WIF — и итог будет про твои пары." : "/watch WIF makes this about your pairs.");
        }
        return text.append('\n').append(ru ? "/weekly off — не присылать.\n<i>Что сделал рынок, а не прогноз. Не финансовый совет.</i>"
                : "/weekly off stops these.\n<i>What the market did, not a forecast. Not financial advice.</i>").toString();
    }
}
