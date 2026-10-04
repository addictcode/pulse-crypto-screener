package dev.pulse.depth;

import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.Deque;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

/**
 * Local copy of one exchange order book, kept in sync from a snapshot plus a stream of
 * incremental updates, following the procedure Binance documents for USDT-M futures:
 * <ol>
 *   <li>buffer stream events while the snapshot is being fetched;</li>
 *   <li>drop buffered events that end before the snapshot;</li>
 *   <li>the first applied event must straddle the snapshot id;</li>
 *   <li>every later event must continue exactly where the previous one ended,
 *       otherwise the book is stale and has to start over from a new snapshot.</li>
 * </ol>
 * All methods lock on the instance: the stream thread writes, the scanner thread reads.
 */
public final class OrderBook {

    /** What the caller should do after feeding an event. */
    public enum Status {
        APPLIED,
        /** No snapshot yet; the event was kept for later. */
        BUFFERED,
        /** The book lost continuity and needs a fresh snapshot. */
        NEEDS_SNAPSHOT
    }

    static final int MAX_BUFFERED = 5_000;

    private final String symbol;
    private final NavigableMap<Double, Double> bids = new TreeMap<>(Comparator.reverseOrder());
    private final NavigableMap<Double, Double> asks = new TreeMap<>();
    private final Deque<DepthUpdate> buffer = new ArrayDeque<>();

    private boolean synced;
    private boolean awaitingFirstEvent;
    private long lastUpdateId;
    private double snapshotBidFloor;
    private double snapshotAskCeiling;

    public OrderBook(String symbol) {
        this.symbol = symbol;
    }

    public String symbol() {
        return symbol;
    }

    public synchronized boolean isSynced() {
        return synced;
    }

    public synchronized Status onUpdate(DepthUpdate update) {
        if (!synced) {
            buffer.addLast(update);
            if (buffer.size() > MAX_BUFFERED) {
                buffer.pollFirst();
            }
            return Status.BUFFERED;
        }
        if (awaitingFirstEvent) {
            if (update.finalUpdateId() < lastUpdateId) {
                return Status.APPLIED; // older than the snapshot, already reflected in it
            }
            if (update.firstUpdateId() > lastUpdateId) {
                return desync(update);
            }
            awaitingFirstEvent = false;
        } else if (update.previousFinalUpdateId() != lastUpdateId) {
            return desync(update);
        }
        apply(update);
        return Status.APPLIED;
    }

    /**
     * @return {@code false} when the snapshot turned out to be older than events already
     * buffered with a gap between them; the caller should fetch another snapshot
     */
    public synchronized boolean onSnapshot(DepthSnapshot snapshot) {
        bids.clear();
        asks.clear();
        load(bids, snapshot.bidPrices(), snapshot.bidQuantities());
        load(asks, snapshot.askPrices(), snapshot.askQuantities());
        lastUpdateId = snapshot.lastUpdateId();
        snapshotBidFloor = bids.isEmpty() ? 0 : bids.lastKey();
        snapshotAskCeiling = asks.isEmpty() ? 0 : asks.lastKey();
        synced = true;
        awaitingFirstEvent = true;

        Deque<DepthUpdate> pending = new ArrayDeque<>(buffer);
        buffer.clear();
        while (!pending.isEmpty()) {
            if (onUpdate(pending.pollFirst()) == Status.NEEDS_SNAPSHOT) {
                buffer.addAll(pending); // keep the newer events for the next snapshot
                return false;
            }
        }
        return true;
    }

    /** Forget everything, e.g. after the stream reconnected and events were certainly lost. */
    public synchronized void reset() {
        synced = false;
        awaitingFirstEvent = false;
        buffer.clear();
        bids.clear();
        asks.clear();
    }

    /**
     * Copies the levels within {@code maxDistancePct} of the mid and prunes levels far beyond it,
     * which the stream keeps teaching us about but nobody will ever look at.
     */
    public synchronized BookView view(double maxDistancePct, double pruneDistancePct) {
        if (!synced || bids.isEmpty() || asks.isEmpty()) {
            return null;
        }
        double bestBid = bids.firstKey();
        double bestAsk = asks.firstKey();
        double mid = (bestBid + bestAsk) / 2;

        bids.tailMap(mid * (1 - pruneDistancePct / 100), false).clear();
        asks.tailMap(mid * (1 + pruneDistancePct / 100), false).clear();

        NavigableMap<Double, Double> nearBids = bids.headMap(mid * (1 - maxDistancePct / 100), true);
        NavigableMap<Double, Double> nearAsks = asks.headMap(mid * (1 + maxDistancePct / 100), true);
        double bidCoverage = snapshotBidFloor > 0 ? (mid - snapshotBidFloor) / mid * 100 : 0;
        double askCoverage = snapshotAskCeiling > 0 ? (snapshotAskCeiling - mid) / mid * 100 : 0;

        double[][] b = toArrays(nearBids);
        double[][] a = toArrays(nearAsks);
        return new BookView(symbol, bestBid, bestAsk, b[0], b[1], a[0], a[1], Math.min(bidCoverage, askCoverage));
    }

    private Status desync(DepthUpdate update) {
        reset();
        buffer.addLast(update);
        return Status.NEEDS_SNAPSHOT;
    }

    private void apply(DepthUpdate update) {
        merge(bids, update.bidPrices(), update.bidQuantities());
        merge(asks, update.askPrices(), update.askQuantities());
        lastUpdateId = update.finalUpdateId();
    }

    private static void load(Map<Double, Double> side, double[] prices, double[] quantities) {
        for (int i = 0; i < prices.length; i++) {
            if (quantities[i] > 0) {
                side.put(prices[i], quantities[i]);
            }
        }
    }

    private static void merge(Map<Double, Double> side, double[] prices, double[] quantities) {
        for (int i = 0; i < prices.length; i++) {
            if (quantities[i] == 0) {
                side.remove(prices[i]);
            } else {
                side.put(prices[i], quantities[i]);
            }
        }
    }

    private static double[][] toArrays(NavigableMap<Double, Double> levels) {
        double[] prices = new double[levels.size()];
        double[] quantities = new double[levels.size()];
        int i = 0;
        for (Map.Entry<Double, Double> level : levels.entrySet()) {
            prices[i] = level.getKey();
            quantities[i++] = level.getValue();
        }
        return new double[][] {prices, quantities};
    }
}
