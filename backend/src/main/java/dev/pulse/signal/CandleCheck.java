package dev.pulse.signal;

import java.util.List;

import dev.pulse.market.Candle;

/**
 * Does the exchange's own record of the minute agree with a signal? The check the 31.10.2026 audit
 * made by hand, and the videos make of every event (video/scripts/archive.mjs, {@code confirm}):
 *
 * <ul>
 *   <li>the signal's price lies within the minute candles around its time (a price spliced in from
 *       another coin, the bug of October 2026, lands far outside them);</li>
 *   <li>a pump or a dump also shows in the candles: from the extreme of the five minutes before to
 *       the extreme of the signal's minute, at least {@link #CONFIRM} of the move it claims, its way.</li>
 * </ul>
 */
final class CandleCheck {

    /** Ticker and candle prices are not taken at the same instant; a hair outside the range is fine. */
    static final double PRICE_SLACK = 0.005;
    static final int WINDOW = 5;
    static final double CONFIRM = 0.6;
    private static final long MINUTE = 60_000;

    enum Verdict { CONFIRMED, FAILED, UNCHECKED }

    record Result(Verdict verdict, String reason) {
        static final Result CONFIRMED = new Result(Verdict.CONFIRMED, "");

        static Result failed(String reason) {
            return new Result(Verdict.FAILED, reason);
        }

        static Result unchecked(String reason) {
            return new Result(Verdict.UNCHECKED, reason);
        }
    }

    private CandleCheck() {
    }

    /** @param candles minute candles of the signal's pair, oldest first */
    static Result check(SignalType type, double price, double value, long firedAt, List<Candle> candles) {
        int at = -1;
        for (int i = candles.size() - 1; i >= 0; i--) {
            long open = candles.get(i).openTime();
            if (open <= firedAt && firedAt < open + MINUTE) {
                at = i;
                break;
            }
        }
        if (at < WINDOW) {
            return Result.unchecked("no candles around the signal");
        }
        Candle now = candles.get(at);
        Candle before = candles.get(at - 1);
        double low = Math.min(now.low(), before.low());
        double high = Math.max(now.high(), before.high());
        if (price < low * (1 - PRICE_SLACK) || price > high * (1 + PRICE_SLACK)) {
            return Result.failed("price %s outside the candles %s–%s".formatted(num(price), num(low), num(high)));
        }
        if (type == SignalType.PUMP || type == SignalType.DUMP) {
            boolean up = type == SignalType.PUMP;
            double base = up ? Double.MAX_VALUE : 0;
            for (int i = at - WINDOW; i <= at; i++) {
                base = up ? Math.min(base, candles.get(i).low()) : Math.max(base, candles.get(i).high());
            }
            double peak = up ? now.high() : now.low();
            double move = (peak / base - 1) * 100;
            double claimed = Math.abs(value);
            if ((up ? move : -move) < claimed * CONFIRM) {
                return Result.failed("candles show %+.1f%%, the signal says %s%.1f%%".formatted(move, up ? "+" : "-", claimed));
            }
        }
        return Result.CONFIRMED;
    }

    private static String num(double v) {
        return String.format(java.util.Locale.ROOT, "%.6g", v);
    }
}
