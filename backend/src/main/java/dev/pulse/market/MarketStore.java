package dev.pulse.market;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Consumer;

import org.springframework.stereotype.Component;

/**
 * In-memory picture of the market, fed by exchange adapters and read by the broadcaster.
 * Tracks which symbols changed since the last read so the frontend only receives deltas.
 */
@Component
public class MarketStore implements MarketSink {

    private static final int RECENT_LIQUIDATIONS = 100;

    private final Map<String, SymbolState> states = new ConcurrentHashMap<>();
    private final Set<String> dirty = ConcurrentHashMap.newKeySet();
    private final Queue<Liquidation> pendingLiquidations = new ConcurrentLinkedQueue<>();
    private final Deque<Liquidation> recentLiquidations = new ArrayDeque<>();

    @Override
    public void onInstruments(List<Instrument> instruments) {
        Set<String> listed = ConcurrentHashMap.newKeySet();
        for (Instrument instrument : instruments) {
            listed.add(instrument.symbol());
            states.computeIfAbsent(instrument.symbol(), SymbolState::new);
        }
        states.keySet().retainAll(listed);
    }

    @Override
    public void onTicker(TickerUpdate ticker) {
        update(ticker.symbol(), s -> s.applyTicker(ticker));
    }

    @Override
    public void onMarkPrice(MarkPriceUpdate markPrice) {
        update(markPrice.symbol(), s -> s.applyMarkPrice(markPrice));
    }

    @Override
    public void onCandle(String symbol, Candle candle) {
        update(symbol, s -> s.applyCandle(candle));
    }

    @Override
    public void onCandleHistory(String symbol, List<Candle> candles) {
        update(symbol, s -> s.applyCandleHistory(candles));
    }

    @Override
    public void onOpenInterest(String symbol, double contracts, long time) {
        update(symbol, s -> s.applyOpenInterest(contracts, time));
    }

    @Override
    public void onLiquidation(Liquidation liquidation) {
        if (update(liquidation.symbol(), s -> s.applyLiquidation(liquidation))) {
            pendingLiquidations.add(liquidation);
            synchronized (recentLiquidations) {
                recentLiquidations.addFirst(liquidation);
                while (recentLiquidations.size() > RECENT_LIQUIDATIONS) {
                    recentLiquidations.pollLast();
                }
            }
        }
    }

    public double volume24h(String symbol) {
        SymbolState state = states.get(symbol);
        return state == null ? 0 : state.quoteVolume24h();
    }

    public Double volumePerMinute(String symbol, int minutes) {
        SymbolState state = states.get(symbol);
        return state == null ? null : state.volumePerMinute(minutes);
    }

    /** Most traded symbols first; the depth feed keeps order books only for these. */
    public List<String> topByVolume(int limit) {
        return states.entrySet().stream()
                .sorted(Comparator.comparingDouble((Map.Entry<String, SymbolState> e) -> e.getValue().quoteVolume24h()).reversed())
                .limit(limit)
                .map(Map.Entry::getKey)
                .toList();
    }

    public boolean isListed(String symbol) {
        return states.containsKey(symbol);
    }

    public List<String> symbols() {
        return states.keySet().stream().sorted().toList();
    }

    public List<SymbolMetrics> snapshot(long now) {
        return states.values().stream()
                .map(s -> s.toMetrics(now))
                .sorted(Comparator.comparingDouble(SymbolMetrics::vol24h).reversed())
                .toList();
    }

    /**
     * Metrics for every symbol that changed since the previous call.
     */
    public List<SymbolMetrics> drainChanged(long now) {
        List<SymbolMetrics> changed = new ArrayList<>(dirty.size());
        for (String symbol : List.copyOf(dirty)) {
            dirty.remove(symbol);
            SymbolState state = states.get(symbol);
            if (state != null) {
                changed.add(state.toMetrics(now));
            }
        }
        return changed;
    }

    public List<Liquidation> drainLiquidations() {
        List<Liquidation> drained = new ArrayList<>();
        Liquidation next;
        while ((next = pendingLiquidations.poll()) != null) {
            drained.add(next);
        }
        return drained;
    }

    public List<Liquidation> recentLiquidations(int limit) {
        synchronized (recentLiquidations) {
            return recentLiquidations.stream().limit(limit).toList();
        }
    }

    public Map<String, List<Double>> sparklines(int points) {
        Map<String, List<Double>> sparks = new LinkedHashMap<>();
        states.forEach((symbol, state) -> sparks.put(symbol, state.sparkline(points)));
        return sparks;
    }

    private boolean update(String symbol, Consumer<SymbolState> change) {
        SymbolState state = states.get(symbol);
        if (state == null) {
            return false; // not a listed USDT perpetual, ignore
        }
        change.accept(state);
        dirty.add(symbol);
        return true;
    }
}
