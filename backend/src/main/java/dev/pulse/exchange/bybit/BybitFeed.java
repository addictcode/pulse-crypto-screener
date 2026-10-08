package dev.pulse.exchange.bybit;

import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import dev.pulse.config.PulseProperties;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;

/**
 * Keeps the latest Bybit tickers in memory. One request returns the whole market, so a plain
 * poll every few seconds is enough; there is no stream to keep alive.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "pulse.bybit", name = "enabled", havingValue = "true")
public class BybitFeed {

    /** Quotes older than this are not worth comparing against a live Binance price. */
    static final long STALE_AFTER_MS = 30_000;

    private final RestClient http;
    private volatile Map<String, BybitQuote> quotes = Map.of();
    private volatile long updatedAt;
    private int failures;

    BybitFeed(RestClient.Builder builder, PulseProperties properties) {
        this.http = builder.baseUrl(properties.bybit().restUrl()).build();
    }

    @Scheduled(fixedDelayString = "${pulse.bybit.poll}", initialDelay = 3_000)
    void poll() {
        try {
            JsonNode body = http.get().uri("/v5/market/tickers?category=linear").retrieve().body(JsonNode.class);
            quotes = BybitParser.tickers(body).stream().collect(Collectors.toMap(BybitQuote::symbol, Function.identity(), (a, b) -> a));
            if (updatedAt == 0) {
                log.info("Bybit: {} USDT perpetuals to compare with", quotes.size());
            }
            updatedAt = System.currentTimeMillis();
            failures = 0;
        } catch (RuntimeException e) {
            // every poll would repeat the same line; the first failure and then every minute or so is enough
            if (failures++ % 12 == 0) {
                log.warn("Bybit: tickers failed: {}", e.getMessage());
            }
        }
    }

    /** Latest quotes by symbol, empty while Bybit is unreachable. */
    public Map<String, BybitQuote> quotes() {
        return System.currentTimeMillis() - updatedAt > STALE_AFTER_MS ? Map.of() : quotes;
    }

    public long updatedAt() {
        return updatedAt;
    }
}
