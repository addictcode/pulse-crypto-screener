package dev.pulse.stream;

import java.util.List;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.depth.DensityScanner;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarketStore;
import dev.pulse.market.SymbolMetrics;
import tools.jackson.databind.json.JsonMapper;

/**
 * Batches market changes into fixed ticks. Pushing every exchange event individually
 * would mean thousands of messages per second; a 500 ms tick keeps the table live
 * while sending each changed row at most twice a second.
 */
@Component
public class MarketBroadcaster {

    /** At the default 500 ms tick, whole rows every 30 seconds. */
    static final int KEYFRAME_EVERY = 60;
    /**
     * The wall list goes out whole, and every wall's age and distance change each second, so a
     * diff would still be the whole list. It was a third of the stream; walls within 5% of the
     * price do not need a fresher picture than every three seconds.
     */
    static final long WALLS_EVERY_MS = 3_000;

    private final MarketStore store;
    private final MarketSocketHandler sockets;
    private final DensityScanner density;
    private final RowDiffer differ;
    private long lastWallsTs;

    public MarketBroadcaster(MarketStore store, MarketSocketHandler sockets, DensityScanner density, JsonMapper mapper) {
        this.store = store;
        this.sockets = sockets;
        this.density = density;
        this.differ = new RowDiffer(mapper, KEYFRAME_EVERY);
    }

    @Scheduled(fixedRateString = "${pulse.stream.broadcast-interval-ms}")
    void tick() {
        long now = System.currentTimeMillis();
        // drain even without clients so a client that connects later does not get a stale burst
        List<SymbolMetrics> changed = store.drainChanged(now);
        List<Liquidation> liquidations = store.drainLiquidations();
        if (!sockets.hasClients()) {
            return;
        }
        var partial = differ.diff(changed);
        if (!partial.isEmpty()) {
            sockets.broadcast(new StreamMessage.Delta(now, partial));
        }
        if (!liquidations.isEmpty()) {
            sockets.broadcast(new StreamMessage.Liquidations(liquidations));
        }
        DensityScanner.DensityState walls = density.latest();
        if (walls.ts() != lastWallsTs && walls.ts() - lastWallsTs >= WALLS_EVERY_MS) {
            lastWallsTs = walls.ts();
            sockets.broadcast(new StreamMessage.Walls(walls.ts(), walls.walls(), walls.coverage()));
        }
    }

    @Scheduled(fixedRate = 60_000, initialDelay = 60_000)
    void sparklines() {
        if (sockets.hasClients()) {
            sockets.broadcast(new StreamMessage.Sparklines(store.sparklines(24)));
        }
    }
}
