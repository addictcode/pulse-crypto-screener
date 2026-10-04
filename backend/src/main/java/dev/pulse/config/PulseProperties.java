package dev.pulse.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("pulse")
public record PulseProperties(Binance binance, Stream stream, Density density) {

    /**
     * @param streamUrl       combined-stream endpoint. Binance moved market data to {@code /market/stream};
     *                        the legacy {@code /stream} accepts subscriptions but stays silent.
     * @param publicStreamUrl order book streams live here, not on the market endpoint
     * @param weightLimit     pause REST calls once Binance reports this much used weight in the minute
     */
    public record Binance(
            boolean enabled,
            String restUrl,
            String streamUrl,
            String publicStreamUrl,
            int depthSnapshotsPerSecond,
            int weightLimit,
            int klineHistory,
            int maxStreamsPerConnection,
            int restRequestsPerSecond,
            Duration openInterestPoll,
            Duration staleAfter) {
    }

    public record Stream(long broadcastIntervalMs, List<String> allowedOrigins) {
    }

    /**
     * @param books            how many of the most traded symbols get a live order book
     * @param maxDistancePct   walls further than this from the price are ignored
     * @param pruneDistancePct levels beyond this are dropped from memory
     */
    public record Density(
            boolean enabled,
            int books,
            Duration reselectInterval,
            long scanIntervalMs,
            double maxDistancePct,
            double pruneDistancePct,
            double bucketPct,
            double multiple,
            double minNotional,
            double volumeShare,
            int maxPerSide) {
    }
}
