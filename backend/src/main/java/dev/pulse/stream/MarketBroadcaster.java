package dev.pulse.stream;

import java.util.List;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.depth.DensityScanner;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarketStore;
import dev.pulse.market.SymbolMetrics;
import lombok.RequiredArgsConstructor;

/**
 * Batches market changes into fixed ticks. Pushing every exchange event individually
 * would mean thousands of messages per second; a 500 ms tick keeps the table live
 * while sending each changed row at most twice a second.
 */
@Component
@RequiredArgsConstructor
public class MarketBroadcaster {

    private final MarketStore store;
    private final MarketSocketHandler sockets;
    private final DensityScanner density;
    private long lastWallsTs;

    @Scheduled(fixedRateString = "${pulse.stream.broadcast-interval-ms}")
    void tick() {
        long now = System.currentTimeMillis();
        // drain even without clients so a client that connects later does not get a stale burst
        List<SymbolMetrics> changed = store.drainChanged(now);
        List<Liquidation> liquidations = store.drainLiquidations();
        if (!sockets.hasClients()) {
            return;
        }
        if (!changed.isEmpty()) {
            sockets.broadcast(new StreamMessage.Delta(now, changed));
        }
        if (!liquidations.isEmpty()) {
            sockets.broadcast(new StreamMessage.Liquidations(liquidations));
        }
        DensityScanner.DensityState walls = density.latest();
        if (walls.ts() != lastWallsTs) {
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
