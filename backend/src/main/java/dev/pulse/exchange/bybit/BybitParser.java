package dev.pulse.exchange.bybit;

import java.util.ArrayList;
import java.util.List;

import tools.jackson.databind.JsonNode;

/**
 * Translates Bybit v5 payloads. Like Binance, Bybit sends numbers as strings, and an empty
 * string where it has nothing to say.
 */
final class BybitParser {

    private static final int DEFAULT_FUNDING_HOURS = 8;

    private BybitParser() {
    }

    /**
     * {@code GET /v5/market/tickers?category=linear}: USDT perpetuals only. The same list also
     * carries USDC perpetuals ("BTCPERP") and dated futures ("BTCUSDT-26DEC26").
     *
     * @throws IllegalStateException when Bybit answers with an error code
     */
    static List<BybitQuote> tickers(JsonNode body) {
        if (body == null || body.path("retCode").asInt(-1) != 0) {
            throw new IllegalStateException("Bybit: " + (body == null ? "empty response" : body.path("retMsg").asString()));
        }
        List<BybitQuote> quotes = new ArrayList<>();
        for (JsonNode t : body.path("result").path("list")) {
            String symbol = t.path("symbol").asString();
            Double price = num(t, "lastPrice");
            if (!symbol.endsWith("USDT") || symbol.contains("-") || price == null || price <= 0) {
                continue;
            }
            Double funding = num(t, "fundingRate");
            Double hours = num(t, "fundingIntervalHour");
            Double turnover = num(t, "turnover24h");
            quotes.add(new BybitQuote(
                    symbol,
                    price,
                    funding == null ? null : funding * 100,
                    hours == null || hours <= 0 ? DEFAULT_FUNDING_HOURS : hours.intValue(),
                    num(t, "openInterestValue"),
                    turnover == null ? 0 : turnover));
        }
        return quotes;
    }

    private static Double num(JsonNode node, String field) {
        String text = node.path(field).asString();
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return Double.parseDouble(text);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
