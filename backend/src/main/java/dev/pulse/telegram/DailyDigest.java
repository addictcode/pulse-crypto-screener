package dev.pulse.telegram;

import java.time.Instant;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import dev.pulse.depth.BookSide;
import dev.pulse.depth.Wall;
import dev.pulse.market.LiquidationTally;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;
import dev.pulse.signal.Text;

import static dev.pulse.telegram.TelegramFormat.CLOCK;
import static dev.pulse.telegram.TelegramFormat.escape;

/**
 * The daily digest: the sharpest moves of the last 24 hours with what the price did an hour
 * later, what got liquidated, and the largest order book walls right now. Unlike the videos it
 * names the coins: it is a live summary, read the day it is posted.
 * <p>
 * Pure selection and formatting; {@link TelegramBot} feeds it and sends it.
 */
final class DailyDigest {

    static final long DAY_MS = 24 * 3_600_000L;
    static final int MOVES = 5;
    static final int WALLS = 3;

    private DailyDigest() {
    }

    /**
     * Pumps and dumps of the last day, the strongest per coin, strongest first: a coin that ran
     * all day would otherwise fill the list on its own.
     */
    static List<Signal> sharpest(List<Signal> signals, long now, int limit) {
        Map<String, Signal> best = new LinkedHashMap<>();
        for (Signal s : signals) {
            if ((s.type() == SignalType.PUMP || s.type() == SignalType.DUMP) && s.time() > now - DAY_MS && s.time() <= now) {
                best.merge(s.symbol(), s, (a, b) -> b.value() > a.value() ? b : a);
            }
        }
        return best.values().stream().sorted(Comparator.comparingDouble(Signal::value).reversed()).limit(limit).toList();
    }

    /** The biggest walls in USD, one per coin. */
    static List<Wall> largest(List<Wall> walls, int limit) {
        return walls.stream()
                .sorted(Comparator.comparingDouble(Wall::size).reversed())
                .collect(java.util.stream.Collectors.toMap(Wall::symbol, Function.identity(), (a, b) -> a, LinkedHashMap::new))
                .values().stream().limit(limit).toList();
    }

    /** Signed move of a pump or dump signal: its value is the size, the type the sign. */
    static double move(Signal s) {
        return s.type() == SignalType.DUMP ? -s.value() : s.value();
    }

    static String format(List<Signal> moves, LiquidationTally.Totals liquidated, List<Wall> walls, long now, boolean ru) {
        StringBuilder text = new StringBuilder("<b>").append(ru ? "Pulse за сутки" : "Pulse, the last 24 hours").append("</b>\n");

        text.append('\n').append(ru ? "<b>Самые резкие движения</b>" : "<b>Sharpest moves</b>").append('\n');
        if (moves.isEmpty()) {
            text.append(ru ? "Ни одного пампа или дампа больше порога." : "No pump or dump above the threshold.").append('\n');
        }
        for (Signal s : moves) {
            text.append(escape(Text.base(s.symbol()))).append(' ').append(Text.pct(move(s), 1))
                    .append(ru ? " за 5 мин, " : " in 5 min, ")
                    .append(CLOCK.format(Instant.ofEpochMilli(s.time()))).append(" UTC");
            if (s.ret1h() != null) {
                text.append(ru ? "; через час " : "; an hour later ").append(Text.pct(s.ret1h(), 1));
            } else if (s.time() > now - 3_600_000L) {
                text.append(ru ? "; час ещё не прошёл" : "; the hour is not up yet");
            }
            text.append('\n');
        }

        text.append('\n').append(ru ? "<b>Ликвидации</b>" : "<b>Liquidations</b>").append('\n');
        boolean partDay = liquidated.since() > now - DAY_MS + 3_600_000L;
        if (liquidated.total() <= 0) {
            text.append(ru ? "Ни одной в потоке биржи" : "None in the exchange feed");
        } else {
            text.append(Text.usd(liquidated.total()))
                    .append(ru ? ": лонги " : ": longs ").append(Text.usd(liquidated.longs()))
                    .append(ru ? ", шорты " : ", shorts ").append(Text.usd(liquidated.shorts()));
        }
        if (partDay) {
            text.append(ru ? " (с " : " (since ").append(CLOCK.format(Instant.ofEpochMilli(liquidated.since()))).append(" UTC)");
        }
        text.append('\n');

        text.append('\n').append(ru ? "<b>Крупнейшие стены сейчас</b>" : "<b>Largest walls now</b>").append('\n');
        if (walls.isEmpty()) {
            text.append(ru ? "Стаканы ещё синхронизируются." : "Order books are still syncing.").append('\n');
        }
        for (Wall w : walls) {
            boolean bid = w.side() == BookSide.BID;
            text.append(escape(Text.base(w.symbol()))).append(' ')
                    .append(ru ? (bid ? "покупка " : "продажа ") : (bid ? "bid " : "ask "))
                    .append(Text.usd(w.size())).append(ru ? " на " : " at ").append(Text.price(w.price()))
                    .append(" (").append(Text.pct(w.distance(), 2)).append(")\n");
        }

        return text.append('\n').append(ru
                ? "<i>Что сделал рынок, а не прогноз. Не финансовый совет.</i>"
                : "<i>What the market did, not a forecast. Not financial advice.</i>").toString();
    }
}
