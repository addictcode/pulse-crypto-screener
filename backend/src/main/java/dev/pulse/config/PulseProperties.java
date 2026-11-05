package dev.pulse.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("pulse")
public record PulseProperties(Binance binance, Bybit bybit, Stream stream, Density density, Signals signals, Setups setups,
                              Telegram telegram, Limits limits) {

    /**
     * What one visitor may take, so a script cannot spend the exchange budget or the upload of
     * the server on everyone else's behalf.
     *
     * @param requestsPerMinute         steady rate of API calls per client address
     * @param burst                     calls a client may make at once, e.g. a page load
     * @param streamClients             market stream connections in total
     * @param streamClientsPerAddress   market stream connections from one address (tabs, a household)
     */
    public record Limits(int requestsPerMinute, int burst, int streamClients, int streamClientsPerAddress) {
    }

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
     * @param timeframes candle sizes on which Pulse Setups are looked for
     * @param pairs      how many of the most traded pairs are watched
     * @param maxOpen    how many trades may be open at once across all pairs and timeframes
     */
    public record Setups(boolean enabled, List<String> timeframes, int pairs, int maxOpen) {
    }

    /**
     * @param ownerChatId   gets setups and everything instantly; in a closed bot the only chat it
     *                      talks to. When empty the bot just tells each sender their chat id so the
     *                      owner can configure it
     * @param open          anyone may /start the bot and get signals with their own settings
     * @param channel       public channel for the free showcase, "@name" or numeric id; empty for none.
     *                      The bot must be an admin there
     * @param channelDelay  how long after the bot the channel gets a signal
     * @param channelPerHour at most this many channel posts an hour; a backlog goes out as one
     * @param channelStrength the channel takes only signals this many times past the system floor
     * @param botUsername   the bot's @username for links on the site; empty to take it from Telegram
     *                      once the bot has started
     * @param digestHour    the hour (UTC, 0-23) of the daily digest in the channel; null for none
     * @param digestLang    the channel digest's language, "en" or "ru"
     */
    public record Telegram(boolean enabled, String token, Long ownerChatId, String apiUrl, boolean open, String channel,
                           Duration channelDelay, int channelPerHour, double channelStrength, String botUsername,
                           Integer digestHour, String digestLang, String siteUrl) {

        public boolean digestInRussian() {
            return "ru".equalsIgnoreCase(digestLang);
        }

        public boolean hasChannel() {
            return channel != null && !channel.isBlank();
        }
    }
}
