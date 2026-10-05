package dev.pulse.exchange.binance;

import java.util.ArrayList;
import java.util.List;

import dev.pulse.depth.DepthSnapshot;
import dev.pulse.depth.DepthUpdate;
import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarkPriceUpdate;
import dev.pulse.market.MarketSink;
import dev.pulse.market.OpenInterestPoint;
import dev.pulse.market.PositionSide;
import dev.pulse.market.TickerUpdate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Translates Binance USDT-M futures payloads (REST and WebSocket) into domain records.
 * Binance sends numbers as strings, hence the {@code num} helper.
 */
final class BinanceParser {

    private final JsonMapper mapper;

    BinanceParser(JsonMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * Routes one combined-stream frame: {"stream": "...", "data": ...}.
     */
    void dispatch(String frame, MarketSink sink) {
        JsonNode root = mapper.readTree(frame);
        JsonNode data = root.path("data");
        if (data.isMissingNode()) {
            return; // subscription ack or error reply
        }
        if (data.isArray()) {
            for (JsonNode item : data) {
                switch (item.path("e").asString()) {
                    case "24hrTicker" -> sink.onTicker(streamTicker(item));
                    case "markPriceUpdate" -> sink.onMarkPrice(markPrice(item));
                    default -> { }
                }
            }
            return;
        }
        switch (data.path("e").asString()) {
            case "kline" -> sink.onCandle(data.path("s").asString(), streamCandle(data.path("k")));
            case "forceOrder" -> sink.onLiquidation(liquidation(data.path("o")));
            default -> { }
        }
    }

    List<Instrument> instruments(JsonNode exchangeInfo) {
        List<Instrument> result = new ArrayList<>();
        for (JsonNode s : exchangeInfo.path("symbols")) {
            if ("PERPETUAL".equals(s.path("contractType").asString())
                    && "USDT".equals(s.path("quoteAsset").asString())
                    && "TRADING".equals(s.path("status").asString())) {
                result.add(new Instrument(s.path("symbol").asString(), s.path("baseAsset").asString(), "USDT"));
            }
        }
        return result;
    }

    List<TickerUpdate> restTickers(JsonNode array) {
        List<TickerUpdate> result = new ArrayList<>();
        for (JsonNode t : array) {
            result.add(new TickerUpdate(
                    t.path("symbol").asString(),
                    num(t, "lastPrice"),
                    num(t, "openPrice"),
                    num(t, "highPrice"),
                    num(t, "lowPrice"),
                    num(t, "quoteVolume"),
                    t.path("closeTime").asLong()));
        }
        return result;
    }

    List<MarkPriceUpdate> restPremiumIndex(JsonNode array) {
        List<MarkPriceUpdate> result = new ArrayList<>();
        for (JsonNode p : array) {
            result.add(new MarkPriceUpdate(
                    p.path("symbol").asString(),
                    num(p, "markPrice"),
                    num(p, "lastFundingRate"),
                    p.path("nextFundingTime").asLong(),
                    p.path("time").asLong()));
        }
        return result;
    }

    /**
     * REST klines are positional arrays: [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...].
     */
    List<Candle> restKlines(JsonNode array, long now) {
        List<Candle> result = new ArrayList<>();
        for (JsonNode k : array) {
            result.add(new Candle(
                    k.get(0).asLong(),
                    k.get(1).asDouble(),
                    k.get(2).asDouble(),
                    k.get(3).asDouble(),
                    k.get(4).asDouble(),
                    k.get(7).asDouble(),
                    k.get(6).asLong() < now));
        }
        return result;
    }

    /** A diff-depth frame from the public stream, or {@code null} for acks and anything else. */
    DepthUpdate depthUpdate(String frame) {
        JsonNode data = mapper.readTree(frame).path("data");
        if (!"depthUpdate".equals(data.path("e").asString())) {
            return null;
        }
        double[][] bids = levels(data.path("b"));
        double[][] asks = levels(data.path("a"));
        return new DepthUpdate(data.path("s").asString(), data.path("U").asLong(), data.path("u").asLong(),
                data.path("pu").asLong(), data.path("E").asLong(), bids[0], bids[1], asks[0], asks[1]);
    }

    DepthSnapshot depthSnapshot(String symbol, JsonNode node) {
        double[][] bids = levels(node.path("bids"));
        double[][] asks = levels(node.path("asks"));
        return new DepthSnapshot(symbol, node.path("lastUpdateId").asLong(), bids[0], bids[1], asks[0], asks[1]);
    }

    /** /futures/data/openInterestHist: 5-minute points, oldest first. */
    List<OpenInterestPoint> openInterestHistory(JsonNode array) {
        List<OpenInterestPoint> points = new ArrayList<>();
        for (JsonNode p : array) {
            points.add(new OpenInterestPoint(p.path("timestamp").asLong(), num(p, "sumOpenInterest")));
        }
        return points;
    }

    double openInterest(JsonNode node) {
        return num(node, "openInterest");
    }

    TickerUpdate streamTicker(JsonNode t) {
        return new TickerUpdate(t.path("s").asString(), num(t, "c"), num(t, "o"), num(t, "h"), num(t, "l"), num(t, "q"), t.path("E").asLong());
    }

    MarkPriceUpdate markPrice(JsonNode m) {
        return new MarkPriceUpdate(m.path("s").asString(), num(m, "p"), num(m, "r"), m.path("T").asLong(), m.path("E").asLong());
    }

    Candle streamCandle(JsonNode k) {
        return new Candle(k.path("t").asLong(), num(k, "o"), num(k, "h"), num(k, "l"), num(k, "c"), num(k, "q"), k.path("x").asBoolean());
    }

    /**
     * In a forced order the exchange trades against the position: SELL closes a long, BUY closes a short.
     */
    Liquidation liquidation(JsonNode o) {
        PositionSide side = "SELL".equals(o.path("S").asString()) ? PositionSide.LONG : PositionSide.SHORT;
        double price = num(o, "ap") > 0 ? num(o, "ap") : num(o, "p");
        return new Liquidation(o.path("s").asString(), side, price, num(o, "z"), o.path("T").asLong());
    }

    /** [["price", "qty"], ...] into parallel arrays. */
    private static double[][] levels(JsonNode array) {
        double[] prices = new double[array.size()];
        double[] quantities = new double[array.size()];
        for (int i = 0; i < array.size(); i++) {
            prices[i] = array.get(i).get(0).asDouble();
            quantities[i] = array.get(i).get(1).asDouble();
        }
        return new double[][] {prices, quantities};
    }

    private static double num(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? 0 : value.asDouble();
    }
}
