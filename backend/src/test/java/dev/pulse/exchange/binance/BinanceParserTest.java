package dev.pulse.exchange.binance;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarkPriceUpdate;
import dev.pulse.market.MarketSink;
import dev.pulse.market.PositionSide;
import dev.pulse.market.TickerUpdate;
import tools.jackson.databind.json.JsonMapper;

/**
 * Frames below are shaped like real ones captured from wss://fstream.binance.com/market/stream.
 */
class BinanceParserTest {

    private final JsonMapper mapper = JsonMapper.builder().build();
    private final BinanceParser parser = new BinanceParser(mapper);
    private final RecordingSink sink = new RecordingSink();

    @Test
    void parsesLiquidationAndMapsTheOrderSideToTheLiquidatedPosition() {
        parser.dispatch("""
                {"stream":"!forceOrder@arr","data":{"e":"forceOrder","E":1791152545116,"o":{"s":"ETHUSDT","S":"BUY","o":"LIMIT",
                "f":"IOC","q":"60.000","p":"2735.93","ap":"2725.49","X":"FILLED","l":"3.766","z":"60.000","T":1791152544106}}}
                """, sink);

        assertThat(sink.liquidations).containsExactly(
                new Liquidation("ETHUSDT", PositionSide.SHORT, 2725.49, 60.0, 1791152544106L));
    }

    @Test
    void parsesKline() {
        parser.dispatch("""
                {"stream":"btcusdt@kline_1m","data":{"e":"kline","E":1791152400100,"s":"BTCUSDT","k":{"t":1791152400000,
                "T":1791152459999,"s":"BTCUSDT","i":"1m","o":"85940.1","c":"85948.2","h":"85950.0","l":"85931.7",
                "v":"12.5","n":340,"x":false,"q":"1074352.9"}}}
                """, sink);

        assertThat(sink.candles).containsExactly(
                new Candle(1791152400000L, 85940.1, 85950.0, 85931.7, 85948.2, 1074352.9, false));
    }

    @Test
    void parsesTickerAndMarkPriceArrays() {
        parser.dispatch("""
                {"stream":"!ticker@arr","data":[{"e":"24hrTicker","E":1791152401000,"s":"WIFUSDT","p":"0.0739",
                "P":"9.62","c":"0.8421","o":"0.7682","h":"0.8530","l":"0.7612","q":"1180000000.5"}]}
                """, sink);
        parser.dispatch("""
                {"stream":"!markPrice@arr@1s","data":[{"e":"markPriceUpdate","E":1791152401000,"s":"WIFUSDT",
                "p":"0.84205","i":"0.84190","r":"0.00012400","T":1791158400000}]}
                """, sink);

        assertThat(sink.tickers).containsExactly(
                new TickerUpdate("WIFUSDT", 0.8421, 0.7682, 0.8530, 0.7612, 1180000000.5, 1791152401000L));
        assertThat(sink.markPrices).containsExactly(
                new MarkPriceUpdate("WIFUSDT", 0.84205, 0.000124, 1791158400000L, 1791152401000L));
    }

    @Test
    void parsesDepthUpdateAndSnapshot() {
        var update = parser.depthUpdate("""
                {"stream":"btcusdt@depth@500ms","data":{"e":"depthUpdate","E":1791152545116,"T":1791152545110,
                "s":"BTCUSDT","U":11734827360804,"u":11734827390088,"pu":11734827360739,
                "b":[["86200.1","1.250"],["86199.9","0"]],"a":[["86200.2","3.5"]]}}
                """);
        var snapshot = parser.depthSnapshot("BTCUSDT", mapper.readTree("""
                {"lastUpdateId":11734828309436,"bids":[["86200.1","1.2"]],"asks":[["86200.2","0.4"],["86200.3","2"]]}
                """));

        assertThat(update.symbol()).isEqualTo("BTCUSDT");
        assertThat(update.previousFinalUpdateId()).isEqualTo(11734827360739L);
        assertThat(update.bidPrices()).containsExactly(86200.1, 86199.9);
        assertThat(update.bidQuantities()).containsExactly(1.25, 0.0);
        assertThat(snapshot.lastUpdateId()).isEqualTo(11734828309436L);
        assertThat(snapshot.askQuantities()).containsExactly(0.4, 2.0);
        assertThat(parser.depthUpdate("{\"result\":null,\"id\":3}")).isNull();
    }

    @Test
    void parsesOpenInterestHistory() {
        var points = parser.openInterestHistory(mapper.readTree("""
                [{"symbol":"WIFUSDT","sumOpenInterest":"73028321.6","sumOpenInterestValue":"18432348.37","timestamp":1791159900000},
                 {"symbol":"WIFUSDT","sumOpenInterest":"73000862.3","sumOpenInterestValue":"18405782.60","timestamp":1791160200000}]
                """));

        assertThat(points).extracting(p -> p.time()).containsExactly(1791159900000L, 1791160200000L);
        assertThat(points.getFirst().contracts()).isEqualTo(73028321.6);
    }

    @Test
    void ignoresSubscriptionAcks() {
        parser.dispatch("{\"result\":null,\"id\":1}", sink);

        assertThat(sink.events).isZero();
    }

    @Test
    void keepsOnlyTradingUsdtPerpetuals() {
        var info = mapper.readTree("""
                {"symbols":[
                  {"symbol":"BTCUSDT","contractType":"PERPETUAL","quoteAsset":"USDT","status":"TRADING","baseAsset":"BTC"},
                  {"symbol":"BTCUSDT_261225","contractType":"CURRENT_QUARTER","quoteAsset":"USDT","status":"TRADING","baseAsset":"BTC"},
                  {"symbol":"ETHUSDC","contractType":"PERPETUAL","quoteAsset":"USDC","status":"TRADING","baseAsset":"ETH"},
                  {"symbol":"OLDUSDT","contractType":"PERPETUAL","quoteAsset":"USDT","status":"SETTLING","baseAsset":"OLD"}
                ]}
                """);

        assertThat(parser.instruments(info)).containsExactly(new Instrument("BTCUSDT", "BTC", "USDT"));
    }

    @Test
    void restKlinesMarkOnlyFinishedMinutesAsClosed() {
        var klines = mapper.readTree("""
                [[1791152340000,"1.0","1.1","0.9","1.05","100",1791152399999,"105.0",10,"50","52.5","0"],
                 [1791152400000,"1.05","1.06","1.04","1.06","20",1791152459999,"21.2",3,"10","10.6","0"]]
                """);

        List<Candle> candles = parser.restKlines(klines, 1791152420000L);

        assertThat(candles).extracting(Candle::closed).containsExactly(true, false);
        assertThat(candles.getFirst().quoteVolume()).isEqualTo(105.0);
    }

    @Test
    void readsStatisticsOldestFirstAndInSeconds() {
        var points = parser.statistic(mapper.readTree("""
                [{"symbol":"BTCUSDT","longShortRatio":"1.8500","timestamp":1791150300000},
                 {"symbol":"BTCUSDT","longShortRatio":"1.7000","timestamp":1791150000000},
                 {"symbol":"BTCUSDT","longShortRatio":"","timestamp":1791150600000}]
                """), "timestamp", "longShortRatio", 1);

        assertThat(points).extracting(p -> p.time(), p -> p.value())
                .containsExactly(org.assertj.core.api.Assertions.tuple(1791150000L, 1.7), org.assertj.core.api.Assertions.tuple(1791150300L, 1.85));
    }

    @Test
    void fundingHistoryIsInPercent() {
        var points = parser.statistic(mapper.readTree("""
                [{"symbol":"BTCUSDT","fundingTime":1791129600000,"fundingRate":"0.00010000","markPrice":"83000.0"}]
                """), "fundingTime", "fundingRate", 100);

        assertThat(points).singleElement().satisfies(p -> {
            assertThat(p.time()).isEqualTo(1791129600L);
            assertThat(p.value()).isCloseTo(0.01, org.assertj.core.api.Assertions.within(1e-12));
        });
    }

    @Test
    void readsFundingIntervalsBySymbol() {
        var hours = parser.fundingIntervals(mapper.readTree("""
                [{"symbol":"GTCUSDT","fundingIntervalHours":8},{"symbol":"WIFUSDT","fundingIntervalHours":4},{"symbol":"ODDUSDT"}]
                """));

        assertThat(hours).containsOnly(java.util.Map.entry("GTCUSDT", 8), java.util.Map.entry("WIFUSDT", 4));
    }

    private static final class RecordingSink implements MarketSink {
        final List<TickerUpdate> tickers = new ArrayList<>();
        final List<MarkPriceUpdate> markPrices = new ArrayList<>();
        final List<Candle> candles = new ArrayList<>();
        final List<Liquidation> liquidations = new ArrayList<>();
        int events;

        @Override public void onInstruments(List<Instrument> instruments) { events++; }
        @Override public void onTicker(TickerUpdate ticker) { events++; tickers.add(ticker); }
        @Override public void onMarkPrice(MarkPriceUpdate markPrice) { events++; markPrices.add(markPrice); }
        @Override public void onCandle(String symbol, Candle candle) { events++; candles.add(candle); }
        @Override public void onCandleHistory(String symbol, List<Candle> history) { events++; }
        @Override public void onOpenInterest(String symbol, double contracts, long time) { events++; }
        @Override public void onLiquidation(Liquidation liquidation) { events++; liquidations.add(liquidation); }
    }
}
