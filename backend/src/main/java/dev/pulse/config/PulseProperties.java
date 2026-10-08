package dev.pulse.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("pulse")
public record PulseProperties(Binance binance, Bybit bybit, Stream stream, Density density, Signals signals, Telegram telegram) {

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

    /**
     * Bybit is a second opinion, not a second market: only its tickers are read, to compare
     * prices, funding and open interest with Binance.
     */
    public record Bybit(boolean enabled, String restUrl, Duration poll) {
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

    /**
     * @param warmup        no signals right after startup, while history and open interest fill in
     * @param minVolume24h  ignore markets thinner than this; their moves are noise
     * @param escalation    inside the cooldown a repeat fires only if this many times stronger
     */
    public record Signals(boolean enabled, long scanIntervalMs, Duration warmup, double minVolume24h, double escalation) {
    }

    /**
     * @param ownerChatId the only chat the bot talks to; when empty the bot just tells each
     *                    sender their chat id so the owner can configure it
     */
    public record Telegram(boolean enabled, String token, Long ownerChatId, String apiUrl) {
    }
}
