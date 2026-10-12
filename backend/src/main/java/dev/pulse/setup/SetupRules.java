package dev.pulse.setup;

import java.util.List;
import java.util.Optional;

import dev.pulse.market.Candle;
import dev.pulse.market.Positioning;

/**
 * Pulse Setups, the same rules as {@code setupsStrategy} in the web client's indicators.ts: join
 * a trend when it breaks out on new money. The trend is the 50 EMA above (below) the 200 with
 * price on the same side; the entry is a close outside the 20-bar range on a burst of volume
 * while open interest is growing. The stop goes behind the last swing, the target three times as
 * far the other way. Change one side and the other has to follow, or the chart and the journal
 * will disagree about what a setup is.
 */
public final class SetupRules {

    static final int MID = 50;
    static final int SLOW = 200;
    static final int RANGE = 20;
    static final double VOLUME = 1.5;
    static final int OI_BARS = 12;
    static final double OI_RISE = 0.01;
    static final int SWING = 5;
    static final double MIN_STOP = 1.2;
    static final double MAX_STOP = 2.5;
    static final double MIN_RISK = 0.004;
    public static final double REWARD = 3;
    /** A trade that has not resolved after this many bars is closed at market. */
    public static final int MAX_BARS = 60;
    /** Taker fee per side on Binance futures without discounts. */
    public static final double FEE = 0.0005;
    /** Candles the rules need before the slow average means anything. */
    public static final int HISTORY = SLOW + 30;
    /** Candles worth asking the exchange for: by then the slow average no longer depends on where it started. */
    public static final int LOOKBACK = 600;

    private SetupRules() {
    }

    /**
     * @param bars         closed candles of one timeframe, oldest first; the last one is judged
     * @param openInterest the exchange's open interest history for the same timeframe, in seconds
     * @param stepSeconds  length of one candle
     * @return the trade to take at the close of the last candle, if its conditions are all met
     */
    public static Optional<SetupPlan> planFor(List<Candle> bars, List<Positioning.Point> openInterest, long stepSeconds) {
        int n = bars.size();
        if (n < HISTORY || openInterest.isEmpty()) {
            return Optional.empty();
        }
        int i = n - 1;
        double[] closes = bars.stream().mapToDouble(Candle::close).toArray();
        double fast = ema(closes, MID);
        double slow = ema(closes, SLOW);
        double close = closes[i];
        int trend = fast > slow && close > slow ? 1 : fast < slow && close < slow ? -1 : 0;
        if (trend == 0) {
            return Optional.empty();
        }

        double high = Double.NEGATIVE_INFINITY;
        double low = Double.POSITIVE_INFINITY;
        for (int k = i - RANGE; k < i; k++) {
            high = Math.max(high, bars.get(k).high());
            low = Math.min(low, bars.get(k).low());
        }
        boolean breakout = trend == 1 ? close > high : close < low;
        double volumeAverage = 0;
        for (int k = i - 19; k <= i; k++) {
            volumeAverage += bars.get(k).quoteVolume() / 20;
        }
        if (!breakout || bars.get(i).quoteVolume() < volumeAverage * VOLUME) {
            return Optional.empty();
        }

        // the latest reading known by the end of each candle, as the chart aligns it
        Double now = readingBefore(openInterest, bars.get(i).openTime() / 1000 + stepSeconds);
        Double then = readingBefore(openInterest, bars.get(i - OI_BARS).openTime() / 1000 + stepSeconds);
        if (now == null || then == null || then == 0 || now / then - 1 <= OI_RISE) {
            return Optional.empty();
        }

        double unit = atr(bars, 14);
        double extreme = trend == 1 ? Double.POSITIVE_INFINITY : Double.NEGATIVE_INFINITY;
        for (int k = i - SWING; k <= i; k++) {
            extreme = trend == 1 ? Math.min(extreme, bars.get(k).low()) : Math.max(extreme, bars.get(k).high());
        }
        double risk = Math.min(Math.max(Math.abs(close - extreme) + 0.2 * unit, MIN_STOP * unit), MAX_STOP * unit);
        if (risk / close < MIN_RISK) {
            return Optional.empty(); // fees would eat too much of a stop this close
        }
        return Optional.of(new SetupPlan(trend, close, close - trend * risk, close + trend * risk * REWARD));
    }

    /** Result in R of leaving a trade at {@code exit}, after fees on both sides. */
    public static double resultR(SetupPlan plan, double exit) {
        return ((exit - plan.entry()) * plan.direction() - 2 * FEE * plan.entry()) / plan.risk();
    }

    /** Exponential average seeded with the plain average of the first {@code length} values. */
    static double ema(double[] values, int length) {
        double average = 0;
        for (int k = 0; k < length; k++) {
            average += values[k] / length;
        }
        double weight = 2.0 / (length + 1);
        for (int k = length; k < values.length; k++) {
            average = values[k] * weight + average * (1 - weight);
        }
        return average;
    }

    /** Average true range with Wilder smoothing. */
    static double atr(List<Candle> bars, int length) {
        double sum = 0;
        double average = 0;
        for (int k = 1; k < bars.size(); k++) {
            Candle bar = bars.get(k);
            double previous = bars.get(k - 1).close();
            double range = Math.max(bar.high() - bar.low(), Math.max(Math.abs(bar.high() - previous), Math.abs(bar.low() - previous)));
            if (k < length) {
                sum += range;
            } else if (k == length) {
                average = (sum + range) / length;
            } else {
                average = (average * (length - 1) + range) / length;
            }
        }
        return average;
    }

    private static Double readingBefore(List<Positioning.Point> points, long beforeSeconds) {
        Double last = null;
        for (Positioning.Point point : points) {
            if (point.time() >= beforeSeconds) {
                break;
            }
            last = point.value();
        }
        return last;
    }
}
