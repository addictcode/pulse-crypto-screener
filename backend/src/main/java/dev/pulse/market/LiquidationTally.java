package dev.pulse.market;

import java.util.Map;
import java.util.TreeMap;

/**
 * Liquidated USD by hour for the last day, for the daily digest. The market store keeps single
 * liquidations only for a few minutes; this keeps their sums, longs and shorts apart.
 * <p>
 * It counts what Binance's liquidation stream reports, which is at most one liquidation per
 * symbol a second: on a violent minute the real total is higher. And it starts empty at every
 * start of Pulse, which {@link Totals#since()} makes visible.
 */
public final class LiquidationTally {

    static final long HOUR_MS = 3_600_000;
    private static final int KEEP_HOURS = 26;

    /** USD liquidated since {@code since}: the requested start, or the start of counting if later. */
    public record Totals(double longs, double shorts, long since) {

        public double total() {
            return longs + shorts;
        }
    }

    private final long startedAt;
    private final TreeMap<Long, double[]> hours = new TreeMap<>();

    public LiquidationTally(long startedAt) {
        this.startedAt = startedAt;
    }

    public synchronized void add(Liquidation l) {
        double[] sums = hours.computeIfAbsent(l.time() / HOUR_MS, h -> new double[2]);
        sums[l.side() == PositionSide.LONG ? 0 : 1] += l.quoteValue();
        while (!hours.isEmpty() && hours.firstKey() < l.time() / HOUR_MS - KEEP_HOURS) {
            hours.pollFirstEntry();
        }
    }

    /** Sums of the whole hours from the one holding {@code from} on: hour resolution is plenty for a day. */
    public synchronized Totals since(long from) {
        double longs = 0;
        double shorts = 0;
        for (Map.Entry<Long, double[]> e : hours.tailMap(from / HOUR_MS, true).entrySet()) {
            longs += e.getValue()[0];
            shorts += e.getValue()[1];
        }
        return new Totals(longs, shorts, Math.max(from, startedAt));
    }
}
