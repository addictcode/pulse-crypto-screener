package dev.pulse.exchange.binance;

import java.util.List;
import java.util.concurrent.locks.LockSupport;

import org.springframework.web.client.RestClient;

import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarkPriceUpdate;
import dev.pulse.market.TickerUpdate;
import tools.jackson.databind.JsonNode;

/**
 * Thin wrapper over the public USDT-M REST API with a client-side rate limiter,
 * so a bootstrap of several hundred symbols never trips Binance's request weight limit.
 */
final class BinanceRestClient {

    private final RestClient http;
    private final BinanceParser parser;
    private final long minIntervalNanos;
    private long nextSlot = System.nanoTime();

    BinanceRestClient(RestClient http, BinanceParser parser, int requestsPerSecond) {
        this.http = http;
        this.parser = parser;
        this.minIntervalNanos = 1_000_000_000L / Math.max(1, requestsPerSecond);
    }

    List<Instrument> instruments() {
        return parser.instruments(get("/fapi/v1/exchangeInfo"));
    }

    List<TickerUpdate> tickers() {
        return parser.restTickers(get("/fapi/v1/ticker/24hr"));
    }

    List<MarkPriceUpdate> premiumIndex() {
        return parser.restPremiumIndex(get("/fapi/v1/premiumIndex"));
    }

    List<Candle> klines(String symbol, int limit) {
        return parser.restKlines(get("/fapi/v1/klines?symbol={symbol}&interval=1m&limit={limit}", symbol, limit),
                System.currentTimeMillis());
    }

    double openInterest(String symbol) {
        return parser.openInterest(get("/fapi/v1/openInterest?symbol={symbol}", symbol));
    }

    /**
     * Always pass a URI template with variables: metrics tag requests by template,
     * a concatenated URI would create one tag per symbol.
     */
    private JsonNode get(String uriTemplate, Object... variables) {
        acquire();
        return http.get().uri(uriTemplate, variables).retrieve().body(JsonNode.class);
    }

    /**
     * Spaces requests evenly. Callers run on virtual threads, so parking here is cheap.
     */
    private void acquire() {
        long wait;
        synchronized (this) {
            long now = System.nanoTime();
            long slot = Math.max(now, nextSlot);
            nextSlot = slot + minIntervalNanos;
            wait = slot - now;
        }
        if (wait > 0) {
            LockSupport.parkNanos(wait);
        }
    }
}
