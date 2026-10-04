package dev.pulse.depth;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;
import dev.pulse.market.MarketStore;

/**
 * Turns the tracked order books into a list of walls once per tick and keeps the latest result
 * for the stream, the REST API and (later) the signal detector.
 */
@Component
public class DensityScanner {

    /**
     * @param coverage per symbol, how far from the price the book is fully known, in percent
     */
    public record DensityState(long ts, List<Wall> walls, Map<String, Double> coverage) {
        static final DensityState EMPTY = new DensityState(0, List.of(), Map.of());
    }

    private final OrderBookStore books;
    private final MarketStore market;
    private final PulseProperties.Density config;
    private final WallDetector.Params params;
    private final WallTracker tracker = new WallTracker();
    private final Set<String> lastScanned = new HashSet<>();

    private volatile DensityState latest = DensityState.EMPTY;

    public DensityScanner(OrderBookStore books, MarketStore market, PulseProperties properties) {
        this.books = books;
        this.market = market;
        this.config = properties.density();
        this.params = new WallDetector.Params(config.bucketPct(), config.multiple(), config.minNotional(),
                config.volumeShare(), config.maxPerSide());
    }

    public DensityState latest() {
        return latest;
    }

    public List<Wall> walls(String symbol) {
        return latest.walls().stream().filter(w -> w.symbol().equals(symbol)).toList();
    }

    /** Synchronized because the tracker is single-threaded and a slow scan must not overlap the next. */
    @Scheduled(fixedRateString = "${pulse.density.scan-interval-ms}")
    synchronized void scan() {
        long now = System.currentTimeMillis();
        List<Wall> walls = new ArrayList<>();
        Map<String, Double> coverage = new LinkedHashMap<>();
        Set<String> scanned = new HashSet<>();

        for (OrderBook book : books.books()) {
            BookView view = book.view(config.maxDistancePct(), config.pruneDistancePct());
            if (view == null) {
                continue;
            }
            String symbol = view.symbol();
            scanned.add(symbol);
            coverage.put(symbol, Math.round(view.coveragePct() * 100) / 100.0);
            double width = tracker.bucketWidth(symbol, view.mid(), config.bucketPct());
            List<WallDetector.Detected> detected = WallDetector.detect(view, width, market.volume24h(symbol), params);
            walls.addAll(tracker.update(symbol, view.mid(), detected, now, market.volumePerMinute(symbol, 5)));
        }

        lastScanned.stream().filter(s -> !scanned.contains(s)).forEach(tracker::forget);
        lastScanned.clear();
        lastScanned.addAll(scanned);

        walls.sort(Comparator.comparingDouble((Wall w) -> Math.abs(w.distance())));
        latest = new DensityState(now, List.copyOf(walls), Map.copyOf(coverage));
    }
}
