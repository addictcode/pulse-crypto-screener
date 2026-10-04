package dev.pulse.market;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure functions over a symbol's recent one-minute candles.
 * Every method returns {@code null} when there is not enough history yet,
 * so the UI can show "warming up" instead of a misleading zero.
 */
public final class MetricsCalculator {

    static final long MINUTE_MS = 60_000L;
    static final int BUCKET_MINUTES = 5;

    private MetricsCalculator() {
    }

    /**
     * Price change over the last {@code minutes}, measured from the open of the candle
     * that started that many minutes ago (the current, still-forming candle counts as one).
     */
    public static Double changePct(List<Candle> candles, double price, int minutes) {
        if (minutes <= 0 || candles.size() < minutes || price <= 0) {
            return null;
        }
        double reference = candles.get(candles.size() - minutes).open();
        return reference > 0 ? (price / reference - 1) * 100 : null;
    }

    /**
     * Volume surge: traded value of the last 5 minutes relative to the average
     * 5-minute value over the preceding hour. 1.0 means a normal pace, 6.0 means six times busier.
     */
    public static Double surge(List<Candle> candles) {
        int recentMinutes = 5;
        int minBaseline = 30;
        int n = candles.size();
        if (n < recentMinutes + minBaseline) {
            return null;
        }
        double recent = quoteVolume(candles, n - recentMinutes, n);
        int baseFrom = Math.max(0, n - recentMinutes - 60);
        int baseMinutes = n - recentMinutes - baseFrom;
        double averageWindow = quoteVolume(candles, baseFrom, n - recentMinutes) / baseMinutes * recentMinutes;
        return averageWindow > 0 ? recent / averageWindow : null;
    }

    /**
     * Normalized ATR in percent on 5-minute bars with Wilder smoothing.
     */
    public static Double natr(List<Candle> candles, int period) {
        List<Candle> bars = toBuckets(candles, BUCKET_MINUTES);
        if (bars.size() < period + 1) {
            return null;
        }
        double atr = 0;
        for (int i = 1; i <= period; i++) {
            atr += trueRange(bars.get(i), bars.get(i - 1).close());
        }
        atr /= period;
        for (int i = period + 1; i < bars.size(); i++) {
            atr = (atr * (period - 1) + trueRange(bars.get(i), bars.get(i - 1).close())) / period;
        }
        double lastClose = bars.getLast().close();
        return lastClose > 0 ? atr / lastClose * 100 : null;
    }

    /**
     * Closes of the last {@code points} 5-minute buckets, oldest first. Feeds the 2h sparkline.
     */
    public static List<Double> sparkline(List<Candle> candles, int points) {
        List<Candle> bars = toBuckets(candles, BUCKET_MINUTES);
        int from = Math.max(0, bars.size() - points);
        List<Double> closes = new ArrayList<>(bars.size() - from);
        for (int i = from; i < bars.size(); i++) {
            closes.add(bars.get(i).close());
        }
        return closes;
    }

    /**
     * Open interest change in percent against the newest snapshot that is at least
     * {@code minutes} old. Uses contracts, not USD, so price moves do not leak into it.
     */
    public static Double openInterestChangePct(List<OpenInterestPoint> history, long now, int minutes) {
        if (history.size() < 2) {
            return null;
        }
        long cutoff = now - minutes * MINUTE_MS;
        OpenInterestPoint reference = null;
        for (OpenInterestPoint point : history) {
            if (point.time() <= cutoff) {
                reference = point;
            }
        }
        double latest = history.getLast().contracts();
        if (reference == null || reference.contracts() <= 0) {
            return null;
        }
        return (latest / reference.contracts() - 1) * 100;
    }

    /**
     * Groups one-minute candles into wall-clock aligned buckets (00:00, 00:05, ...).
     */
    static List<Candle> toBuckets(List<Candle> candles, int minutes) {
        long size = minutes * MINUTE_MS;
        List<Candle> buckets = new ArrayList<>();
        long bucketStart = Long.MIN_VALUE;
        double open = 0, high = 0, low = 0, close = 0, volume = 0;
        boolean closed = false;
        for (Candle c : candles) {
            long start = Math.floorDiv(c.openTime(), size) * size;
            if (start != bucketStart) {
                if (bucketStart != Long.MIN_VALUE) {
                    buckets.add(new Candle(bucketStart, open, high, low, close, volume, closed));
                }
                bucketStart = start;
                open = c.open();
                high = c.high();
                low = c.low();
                volume = 0;
            }
            high = Math.max(high, c.high());
            low = Math.min(low, c.low());
            close = c.close();
            volume += c.quoteVolume();
            closed = c.closed() && c.openTime() + MINUTE_MS == start + size;
        }
        if (bucketStart != Long.MIN_VALUE) {
            buckets.add(new Candle(bucketStart, open, high, low, close, volume, closed));
        }
        return buckets;
    }

    private static double trueRange(Candle bar, double previousClose) {
        return Math.max(bar.high() - bar.low(),
                Math.max(Math.abs(bar.high() - previousClose), Math.abs(bar.low() - previousClose)));
    }

    private static double quoteVolume(List<Candle> candles, int from, int to) {
        double sum = 0;
        for (int i = from; i < to; i++) {
            sum += candles.get(i).quoteVolume();
        }
        return sum;
    }
}
