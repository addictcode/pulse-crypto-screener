package dev.pulse.depth;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Finds unusually large resting orders ("walls", "densities") in a book.
 * <p>
 * Raw price levels are too fine to compare: a 2M wall is often spread over a few neighbouring
 * ticks. Levels are therefore grouped into buckets of a fixed fraction of the price, and a bucket
 * counts as a wall when it is many times the typical bucket <em>and</em> large in absolute terms
 * for this market. The absolute floor scales with daily volume, otherwise every level in BTC would
 * qualify next to a thin altcoin.
 */
public final class WallDetector {

    /**
     * @param bucketPct    bucket width as a percent of price
     * @param multiple     how many times the median bucket a wall must be
     * @param minNotional  absolute floor in USD for any market
     * @param volumeShare  floor as a share of 24h volume, e.g. 0.0003 = 0.03%
     * @param maxPerSide   keep only the largest walls per side
     */
    public record Params(double bucketPct, double multiple, double minNotional, double volumeShare, int maxPerSide) {
    }

    /** A detected bucket. {@code bucket} identifies it across scans as long as the width is unchanged. */
    public record Detected(BookSide side, long bucket, double price, double notional, double multiple) {
    }

    private WallDetector() {
    }

    /**
     * @param bucketWidth absolute bucket width in price units; callers keep it fixed per symbol so
     *                    bucket ids stay stable while the price drifts
     */
    public static List<Detected> detect(BookView view, double bucketWidth, double volume24h, Params params) {
        Map<Long, Bucket> bids = bucket(view.bidPrices(), view.bidQuantities(), bucketWidth);
        Map<Long, Bucket> asks = bucket(view.askPrices(), view.askQuantities(), bucketWidth);

        double median = medianNotional(view, bids, asks);
        if (median <= 0) {
            return List.of();
        }
        double threshold = Math.max(median * params.multiple(), Math.max(params.minNotional(), volume24h * params.volumeShare()));

        List<Detected> walls = new ArrayList<>();
        walls.addAll(pick(BookSide.BID, bids, threshold, median, params.maxPerSide()));
        walls.addAll(pick(BookSide.ASK, asks, threshold, median, params.maxPerSide()));
        return walls;
    }

    /** Absolute bucket width for a price. */
    public static double bucketWidth(double price, double bucketPct) {
        return price * bucketPct / 100;
    }

    private static List<Detected> pick(BookSide side, Map<Long, Bucket> buckets, double threshold, double median, int limit) {
        return buckets.entrySet().stream()
                .filter(e -> e.getValue().notional >= threshold)
                .sorted(Comparator.comparingDouble((Map.Entry<Long, Bucket> e) -> e.getValue().notional).reversed())
                .limit(limit)
                .map(e -> new Detected(side, e.getKey(), e.getValue().peakPrice, e.getValue().notional, e.getValue().notional / median))
                .toList();
    }

    /**
     * The baseline only uses buckets inside the snapshot's coverage: beyond it the book is sparse
     * (only levels that changed are known), which would drag the median around.
     */
    private static double medianNotional(BookView view, Map<Long, Bucket> bids, Map<Long, Bucket> asks) {
        double mid = view.mid();
        double coverage = view.coveragePct();
        double[] sizes = Stream.concat(bids.values().stream(), asks.values().stream())
                .filter(b -> coverage <= 0 || Math.abs(b.peakPrice - mid) / mid * 100 <= coverage)
                .mapToDouble(b -> b.notional)
                .sorted()
                .toArray();
        if (sizes.length == 0) {
            return 0;
        }
        int middle = sizes.length / 2;
        return sizes.length % 2 == 1 ? sizes[middle] : (sizes[middle - 1] + sizes[middle]) / 2;
    }

    private static Map<Long, Bucket> bucket(double[] prices, double[] quantities, double width) {
        Map<Long, Bucket> buckets = new HashMap<>();
        for (int i = 0; i < prices.length; i++) {
            // epsilon: 99.0 / 0.05 can come out as 1979.9999..., which would merge two neighbouring buckets
            long id = (long) Math.floor(prices[i] / width + 1e-9);
            double notional = prices[i] * quantities[i];
            Bucket b = buckets.computeIfAbsent(id, k -> new Bucket());
            b.notional += notional;
            if (notional > b.peakNotional) {
                b.peakNotional = notional;
                b.peakPrice = prices[i];
            }
        }
        return buckets;
    }

    private static final class Bucket {
        double notional;
        double peakNotional;
        /** The single heaviest level in the bucket: where the wall actually sits. */
        double peakPrice;
    }
}
