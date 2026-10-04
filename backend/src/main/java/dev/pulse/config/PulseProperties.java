package dev.pulse.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("pulse")
public record PulseProperties(Binance binance, Stream stream) {

    /**
     * @param streamUrl combined-stream endpoint. Binance moved market data to {@code /market/stream};
     *                  the legacy {@code /stream} accepts subscriptions but stays silent.
     */
    public record Binance(
            boolean enabled,
            String restUrl,
            String streamUrl,
            int klineHistory,
            int maxStreamsPerConnection,
            int restRequestsPerSecond,
            Duration openInterestPoll,
            Duration staleAfter) {
    }

    public record Stream(long broadcastIntervalMs, List<String> allowedOrigins) {
    }
}
