package dev.pulse.exchange.binance;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.LockSupport;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

import dev.pulse.depth.DepthSnapshot;
import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarkPriceUpdate;
import dev.pulse.market.OpenInterestPoint;
import dev.pulse.market.Positioning;
import dev.pulse.market.TickerUpdate;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;

/**
 * Thin wrapper over the public USDT-M REST API that keeps us inside Binance's limits.
 * <p>
 * Requests go through separate lanes so slow background work never delays what a user is
 * waiting for: background (history, open interest), interactive (chart history) and depth
 * (order book snapshots, which are expensive). On top of that every response reports the weight
 * used in the current minute; when it gets close to the limit, all lanes pause until the minute
 * rolls over, and a 429 or 418 stops everything for as long as Binance asks.
 */
@Slf4j
final class BinanceRestClient {

    private static final int INTERACTIVE_REQUESTS_PER_SECOND = 5;
    private static final String USED_WEIGHT_HEADER = "X-MBX-USED-WEIGHT-1M";
    private static final Duration DEFAULT_BACKOFF = Duration.ofSeconds(60);

    private final RestClient http;
    private final BinanceParser parser;
    private final int weightLimit;
    private final RateLimiter background;
    private final RateLimiter interactive = new RateLimiter(INTERACTIVE_REQUESTS_PER_SECOND);
    private final RateLimiter depth;

    private volatile long pausedUntil;
    private volatile int usedWeight;

    BinanceRestClient(RestClient http, BinanceParser parser, int backgroundRequestsPerSecond, int depthRequestsPerSecond, int weightLimit) {
        this.http = http;
        this.parser = parser;
        this.weightLimit = weightLimit;
        this.background = new RateLimiter(backgroundRequestsPerSecond);
        this.depth = new RateLimiter(depthRequestsPerSecond);
    }

    int usedWeight() {
        return usedWeight;
    }

    List<Instrument> instruments() {
        return parser.instruments(get(background, "/fapi/v1/exchangeInfo"));
    }

    List<TickerUpdate> tickers() {
        return parser.restTickers(get(background, "/fapi/v1/ticker/24hr"));
    }

    List<MarkPriceUpdate> premiumIndex() {
        return parser.restPremiumIndex(get(background, "/fapi/v1/premiumIndex"));
    }

    /** Funding interval in hours by symbol; Binance lists the contracts it has adjusted. */
    Map<String, Integer> fundingIntervals() {
        return parser.fundingIntervals(get(background, "/fapi/v1/fundingInfo"));
    }

    /**
     * Requested by a user looking at one pair, so it rides the interactive lane. A series that
     * fails comes back empty: these statistics lag or go missing on freshly listed contracts.
     */
    List<Positioning.Point> statistic(String path, String symbol, String period, int limit, String valueField) {
        try {
            JsonNode body = get(interactive, "/futures/data/" + path + "?symbol={symbol}&period={period}&limit={limit}", symbol, period, limit);
            return parser.statistic(body, "timestamp", valueField, 1);
        } catch (RuntimeException e) {
            log.debug("Binance: {} for {} failed: {}", path, symbol, e.getMessage());
            return List.of();
        }
    }

    /** Past funding payments, in percent. */
    List<Positioning.Point> fundingHistory(String symbol, int limit) {
        try {
            JsonNode body = get(interactive, "/fapi/v1/fundingRate?symbol={symbol}&limit={limit}", symbol, limit);
            return parser.statistic(body, "fundingTime", "fundingRate", 100);
        } catch (RuntimeException e) {
            log.debug("Binance: funding history for {} failed: {}", symbol, e.getMessage());
            return List.of();
        }
    }

    /** One-minute history for the metrics engine. */
    List<Candle> historyKlines(String symbol, int limit) {
        return klines(background, symbol, "1m", limit);
    }

    /** Chart history requested by a user who is waiting for it. */
    List<Candle> chartKlines(String symbol, String interval, int limit) {
        return klines(interactive, symbol, interval, limit);
    }

    double openInterest(String symbol) {
        return parser.openInterest(get(background, "/fapi/v1/openInterest?symbol={symbol}", symbol));
    }

    /** Recent 5-minute open interest, so the 15-minute change is known right after startup. */
    List<OpenInterestPoint> openInterestHistory(String symbol, int points) {
        return parser.openInterestHistory(
                get(background, "/futures/data/openInterestHist?symbol={symbol}&period=5m&limit={limit}", symbol, points));
    }

    /** The deepest snapshot Binance offers (1000 levels per side, weight 20). */
    DepthSnapshot depthSnapshot(String symbol) {
        return parser.depthSnapshot(symbol, get(depth, "/fapi/v1/depth?symbol={symbol}&limit=1000", symbol));
    }

    private List<Candle> klines(RateLimiter lane, String symbol, String interval, int limit) {
        JsonNode body = get(lane, "/fapi/v1/klines?symbol={symbol}&interval={interval}&limit={limit}", symbol, interval, limit);
        return parser.restKlines(body, System.currentTimeMillis());
    }

    /**
     * Always pass a URI template with variables: metrics tag requests by template,
     * a concatenated URI would create one tag per symbol.
     */
    private JsonNode get(RateLimiter lane, String uriTemplate, Object... variables) {
        lane.acquire();
        waitWhilePaused();
        try {
            ResponseEntity<JsonNode> response = http.get().uri(uriTemplate, variables).retrieve().toEntity(JsonNode.class);
            trackWeight(response.getHeaders().getFirst(USED_WEIGHT_HEADER));
            return response.getBody();
        } catch (HttpClientErrorException e) {
            if (e.getStatusCode() == HttpStatus.TOO_MANY_REQUESTS || e.getStatusCode().value() == 418) {
                String retryAfter = e.getResponseHeaders() == null ? null : e.getResponseHeaders().getFirst("Retry-After");
                Duration backoff = retryAfter == null ? DEFAULT_BACKOFF : Duration.ofSeconds(Long.parseLong(retryAfter));
                pausedUntil = System.currentTimeMillis() + backoff.toMillis();
                log.warn("Binance rate limit hit ({}), pausing REST for {} s", e.getStatusCode().value(), backoff.toSeconds());
            }
            throw e;
        }
    }

    private void trackWeight(String header) {
        if (header == null) {
            return;
        }
        usedWeight = Integer.parseInt(header);
        if (usedWeight >= weightLimit) {
            long now = System.currentTimeMillis();
            long nextMinute = (now / 60_000 + 1) * 60_000;
            pausedUntil = Math.max(pausedUntil, nextMinute);
            log.info("Binance weight {} of the minute used, pausing REST for {} ms", usedWeight, nextMinute - now);
        }
    }

    private void waitWhilePaused() {
        long wait;
        while ((wait = pausedUntil - System.currentTimeMillis()) > 0) {
            LockSupport.parkNanos(wait * 1_000_000);
        }
    }
}
