package dev.pulse.market;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.TreeMap;

/**
 * Live state of one symbol. Writers (exchange streams) and the reader (broadcaster)
 * run on different threads, so every method locks on the instance. Critical sections
 * are short: no I/O and no allocation-heavy work happens under the lock except
 * building the metrics row.
 */
final class SymbolState {

    static final int MAX_CANDLES = 180;
    static final int MAX_OPEN_INTEREST_POINTS = 40;
    static final long LIQUIDATION_WINDOW_MS = 5 * MetricsCalculator.MINUTE_MS;

    private final String symbol;
    private final Deque<Candle> candles = new ArrayDeque<>();
    private final Deque<OpenInterestPoint> openInterest = new ArrayDeque<>();
    private final Deque<Liquidation> liquidations = new ArrayDeque<>();

    private double price;
    private double openPrice24h;
    private double highPrice24h;
    private double lowPrice24h;
    private double quoteVolume24h;
    private double markPrice;
    private Double fundingRate;
    private Long nextFundingTime;

    SymbolState(String symbol) {
        this.symbol = symbol;
    }

    synchronized void applyTicker(TickerUpdate t) {
        price = t.lastPrice();
        openPrice24h = t.openPrice24h();
        highPrice24h = t.highPrice24h();
        lowPrice24h = t.lowPrice24h();
        quoteVolume24h = t.quoteVolume24h();
    }

    synchronized void applyMarkPrice(MarkPriceUpdate m) {
        markPrice = m.markPrice();
        fundingRate = m.fundingRate();
        nextFundingTime = m.nextFundingTime();
    }

    /**
     * Upserts a streamed candle: the stream repeats the forming candle many times a second.
     */
    synchronized void applyCandle(Candle c) {
        Candle last = candles.peekLast();
        if (last == null || c.openTime() > last.openTime()) {
            candles.addLast(c);
            trimCandles();
        } else if (c.openTime() == last.openTime()) {
            candles.pollLast();
            candles.addLast(c);
        } else {
            return; // late update for an older minute, the history already has it
        }
        price = c.close();
    }

    /**
     * Merges REST history with whatever the stream delivered meanwhile; streamed candles win
     * because they are newer.
     */
    synchronized void applyCandleHistory(List<Candle> history) {
        TreeMap<Long, Candle> merged = new TreeMap<>();
        history.forEach(c -> merged.put(c.openTime(), c));
        candles.forEach(c -> merged.put(c.openTime(), c));
        candles.clear();
        candles.addAll(merged.values());
        trimCandles();
        if (price == 0 && !candles.isEmpty()) {
            price = candles.peekLast().close();
        }
    }

    synchronized void applyOpenInterest(double contracts, long time) {
        openInterest.addLast(new OpenInterestPoint(time, contracts));
        while (openInterest.size() > MAX_OPEN_INTEREST_POINTS) {
            openInterest.pollFirst();
        }
    }

    synchronized void applyLiquidation(Liquidation l) {
        liquidations.addLast(l);
    }

    synchronized SymbolMetrics toMetrics(long now) {
        while (!liquidations.isEmpty() && liquidations.peekFirst().time() < now - LIQUIDATION_WINDOW_MS) {
            liquidations.pollFirst();
        }
        List<Candle> history = new ArrayList<>(candles);
        List<OpenInterestPoint> oiHistory = new ArrayList<>(openInterest);
        double liq5m = 0;
        for (Liquidation l : liquidations) {
            liq5m += l.quoteValue();
        }
        Double oiUsd = oiHistory.isEmpty() || markPrice == 0 ? null : oiHistory.getLast().contracts() * markPrice;
        // rounded here, at the edge: full double precision would triple the size of every delta
        return new SymbolMetrics(
                symbol,
                price,
                round(MetricsCalculator.changePct(history, price, 1), 3),
                round(MetricsCalculator.changePct(history, price, 5), 3),
                round(MetricsCalculator.changePct(history, price, 15), 3),
                round(MetricsCalculator.changePct(history, price, 60), 3),
                round(openPrice24h > 0 ? (price / openPrice24h - 1) * 100 : null, 3),
                // the ticker refreshes once a second, the live price can already be outside its range
                highPrice24h > 0 ? Math.max(highPrice24h, price) : null,
                lowPrice24h > 0 ? Math.min(lowPrice24h, price) : null,
                Math.round(quoteVolume24h),
                round(MetricsCalculator.surge(history), 2),
                round(MetricsCalculator.natr(history, 14), 3),
                round(fundingRate == null ? null : fundingRate * 100, 4),
                nextFundingTime,
                round(oiUsd, 0),
                round(MetricsCalculator.openInterestChangePct(oiHistory, now, 15), 2),
                Math.round(liq5m));
    }

    /** USD liquidated in the last 5 minutes: [longs, shorts]. */
    synchronized double[] liquidationsBySide(long now) {
        double longs = 0;
        double shorts = 0;
        for (Liquidation l : liquidations) {
            if (l.time() < now - LIQUIDATION_WINDOW_MS) {
                continue;
            }
            if (l.side() == PositionSide.LONG) {
                longs += l.quoteValue();
            } else {
                shorts += l.quoteValue();
            }
        }
        return new double[] {longs, shorts};
    }

    synchronized double quoteVolume24h() {
        return quoteVolume24h;
    }

    /** Average traded value per minute over the last {@code minutes} candles, or null without history. */
    synchronized Double volumePerMinute(int minutes) {
        if (candles.size() < minutes) {
            return null;
        }
        double sum = 0;
        int counted = 0;
        for (var it = candles.descendingIterator(); it.hasNext() && counted < minutes; counted++) {
            sum += it.next().quoteVolume();
        }
        return sum / minutes;
    }

    synchronized List<Double> sparkline(int points) {
        return MetricsCalculator.sparkline(new ArrayList<>(candles), points);
    }

    private static Double round(Double value, int decimals) {
        if (value == null || value.isNaN() || value.isInfinite()) {
            return null;
        }
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }

    private void trimCandles() {
        while (candles.size() > MAX_CANDLES) {
            candles.pollFirst();
        }
    }
}
