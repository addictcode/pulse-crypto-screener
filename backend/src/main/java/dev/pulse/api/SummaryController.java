package dev.pulse.api;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.Wall;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarketStore;
import dev.pulse.market.SymbolMetrics;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.TapeDetector;
import dev.pulse.signal.TapeItem;
import dev.pulse.status.FeedAge;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/summary}: what the landing page shows, for a poll every few seconds instead of
 * the full market stream. Most visitors only look at the landing, and it needs five fields of each
 * pair, the walls near the price and the latest events, not every field of every pair twice a
 * second (see loadtest/REPORT.md). The answer is built and serialised at most once per
 * {@link #TTL_MS} and the same bytes go to everyone asking meanwhile, so a crowd costs no more
 * work than one visitor.
 */
@RestController
@RequestMapping("/api")
public class SummaryController {

    static final long TTL_MS = 2_000;
    /** The landing shows walls within this distance of the price, in percent. */
    static final double NEAR_WALLS_PCT = 2.0;
    static final int SIGNALS = 30;
    static final int TAPE = 80;
    static final int LIQUIDATIONS = 50;
    /** As the stream sends them: 24 five-minute closes, the cards' two hours. */
    static final int SPARKLINE_POINTS = 24;

    /** One pair as the landing uses it: the planet, the ticker, the movers and the totals. */
    public record Row(String symbol, double price, Double ch5m, Double ch24h, double vol24h) {
        static Row of(SymbolMetrics m) {
            return new Row(m.symbol(), m.price(), m.ch5m(), m.ch24h(), m.vol24h());
        }
    }

    public record Walls(long ts, List<Wall> walls, Map<String, Double> coverage) {
    }

    /**
     * @param sparklines two hours of each pair the events below name: the phone's live feed draws
     *                   them on its cards (every pair's would triple the answer)
     * @param feedAge    milliseconds since the exchange's newest frame, on the server's clock; past
     *                   {@link FeedAge#STALE_MS} the landing says the numbers are not live
     */
    public record Summary(long ts, List<Row> rows, List<Liquidation> liquidations, Walls walls,
            List<Signal> signals, List<TapeItem> tape, Map<String, List<Double>> sparklines, Long feedAge) {
    }

    private record Built(long at, byte[] json) {
    }

    private final MarketStore store;
    private final DensityScanner density;
    private final SignalHistory signals;
    private final ObjectProvider<TapeDetector> tape;
    private final FeedAge feed;
    private final JsonMapper mapper;
    private final LongSupplier clock;
    private volatile Built latest;

    @Autowired
    public SummaryController(MarketStore store, DensityScanner density, SignalHistory signals,
            ObjectProvider<TapeDetector> tape, FeedAge feed, JsonMapper mapper) {
        this(store, density, signals, tape, feed, mapper, System::currentTimeMillis);
    }

    SummaryController(MarketStore store, DensityScanner density, SignalHistory signals,
            ObjectProvider<TapeDetector> tape, FeedAge feed, JsonMapper mapper, LongSupplier clock) {
        this.store = store;
        this.density = density;
        this.signals = signals;
        this.tape = tape;
        this.feed = feed;
        this.mapper = mapper;
        this.clock = clock;
    }

    @GetMapping(value = "/summary", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> summary() {
        long now = clock.getAsLong();
        Built built = latest;
        if (built == null || now - built.at() >= TTL_MS) {
            synchronized (this) {
                built = latest;
                // whoever waited on the lock finds it fresh and does not build it again
                if (built == null || now - built.at() >= TTL_MS) {
                    built = new Built(now, mapper.writeValueAsBytes(build(now)));
                    latest = built;
                }
            }
        }
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(built.json());
    }

    Summary build(long now) {
        DensityScanner.DensityState state = density.latest();
        List<Wall> near = state.walls().stream().filter(w -> Math.abs(w.distance()) <= NEAR_WALLS_PCT).toList();
        TapeDetector detector = tape.getIfAvailable();
        List<Liquidation> liquidations = store.recentLiquidations(LIQUIDATIONS);
        List<Signal> recentSignals = signals.recent(SIGNALS);
        List<TapeItem> recentTape = detector == null ? List.of() : detector.recent(TAPE);
        Set<String> named = new HashSet<>();
        liquidations.forEach(l -> named.add(l.symbol()));
        recentSignals.forEach(s -> named.add(s.symbol()));
        recentTape.forEach(t -> named.add(t.symbol()));
        Map<String, List<Double>> sparklines = store.sparklines(named, SPARKLINE_POINTS);
        return new Summary(
                now,
                store.snapshot(now).stream().map(Row::of).toList(),
                liquidations,
                new Walls(state.ts(), near, state.coverage()),
                recentSignals,
                recentTape,
                sparklines,
                feed.at(now));
    }
}
