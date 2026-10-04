package dev.pulse.exchange.binance;

import java.util.List;

import org.springframework.web.client.RestClient;

import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarkPriceUpdate;
import dev.pulse.market.TickerUpdate;
import tools.jackson.databind.JsonNode;

/**
 * Thin wrapper over the public USDT-M REST API with client-side rate limiting, so a bootstrap
 * of several hundred symbols never trips Binance's request weight limit.
 * <p>
 * Two lanes: background work (history, open interest) and interactive requests from the UI.
 * With one shared queue a chart request at startup would wait behind ~500 history loads.
 */
final class BinanceRestClient {

    private static final int INTERACTIVE_REQUESTS_PER_SECOND = 5;

    private final RestClient http;
    private final BinanceParser parser;
    private final RateLimiter background;
    private final RateLimiter interactive = new RateLimiter(INTERACTIVE_REQUESTS_PER_SECOND);

    BinanceRestClient(RestClient http, BinanceParser parser, int backgroundRequestsPerSecond) {
        this.http = http;
        this.parser = parser;
        this.background = new RateLimiter(backgroundRequestsPerSecond);
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
        return http.get().uri(uriTemplate, variables).retrieve().body(JsonNode.class);
    }
}
