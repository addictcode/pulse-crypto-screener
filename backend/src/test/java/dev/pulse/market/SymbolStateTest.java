package dev.pulse.market;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.List;

import org.junit.jupiter.api.Test;

class SymbolStateTest {

    @Test
    void streamedCandleReplacesTheFormingMinuteAndAppendsTheNextOne() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyCandle(new Candle(0, 1.00, 1.01, 0.99, 1.00, 10, false));
        state.applyCandle(new Candle(0, 1.00, 1.02, 0.99, 1.02, 15, true));
        state.applyCandle(new Candle(60_000, 1.02, 1.03, 1.02, 1.03, 5, false));

        SymbolMetrics m = state.toMetrics(120_000);

        assertThat(m.price()).isEqualTo(1.03);
        assertThat(m.ch1m()).isCloseTo((1.03 / 1.02 - 1) * 100, within(0.001));
    }

    @Test
    void historyMergeKeepsStreamedCandlesBecauseTheyAreNewer() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyCandle(new Candle(120_000, 1.10, 1.12, 1.09, 1.11, 50, false));

        state.applyCandleHistory(List.of(
                new Candle(0, 1.00, 1.01, 0.99, 1.00, 10, true),
                new Candle(60_000, 1.00, 1.05, 1.00, 1.05, 20, true),
                new Candle(120_000, 1.05, 1.06, 1.05, 1.06, 1, false)));

        SymbolMetrics m = state.toMetrics(150_000);
        assertThat(m.price()).isEqualTo(1.11);
        assertThat(m.ch1m()).as("current minute opened at the streamed 1.10, not the stale REST 1.05")
                .isCloseTo((1.11 / 1.10 - 1) * 100, within(0.001));
    }

    @Test
    void openInterestHistoryArrivingAfterALivePollStillCounts() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyMarkPrice(new MarkPriceUpdate("WIFUSDT", 1.0, 0.0001, 0, 0));
        long now = 20 * 60_000;
        state.applyOpenInterest(1_100, now);           // live poll lands first
        state.applyOpenInterest(1_000, now - 20 * 60_000); // history after it
        state.applyOpenInterest(1_050, now - 10 * 60_000);

        assertThat(state.toMetrics(now).oiCh15m()).isEqualTo(10.0);
    }

    @Test
    void liquidationsOlderThanFiveMinutesDropOutOfTheSum() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyLiquidation(new Liquidation("WIFUSDT", PositionSide.LONG, 1.0, 1_000, 0));
        state.applyLiquidation(new Liquidation("WIFUSDT", PositionSide.SHORT, 2.0, 500, 290_000));

        assertThat(state.toMetrics(310_000).liq5m()).isEqualTo(1_000);
    }

    private static TickerUpdate ticker(double price) {
        return new TickerUpdate("WIFUSDT", price, price, price * 1.1, price * 0.9, 1e9, 0);
    }

    @Test
    void aStrayPriceFromAnotherCoinIsHeldBackAndDropped() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyTicker(ticker(1.00));
        // a frame of BTC's stream glued onto WIF's (October 2026)
        assertThat(state.applyCandle(new Candle(0, 83_000, 83_100, 82_900, 83_000, 10, false))).isFalse();
        assertThat(state.toMetrics(30_000).price()).isEqualTo(1.00);
        // the next update is WIF again: the stray price is gone for good
        assertThat(state.applyTicker(ticker(1.01))).isTrue();
        assertThat(state.toMetrics(30_000).price()).isEqualTo(1.01);
        assertThat(state.rejectedPrices()).isEqualTo(1);
    }

    @Test
    void aRealSharpMoveIsTakenOnTheSecondUpdate() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyTicker(ticker(1.00));
        // a fresh listing or a squeeze: up 150% at once, and it stays there
        assertThat(state.applyTicker(ticker(2.50))).isFalse();
        assertThat(state.applyCandle(new Candle(0, 1.0, 2.6, 1.0, 2.55, 10, false))).isTrue();
        assertThat(state.toMetrics(30_000).price()).isEqualTo(2.55);
        assertThat(state.applyTicker(ticker(2.52))).isTrue();
        assertThat(state.rejectedPrices()).isZero();
    }

    @Test
    void anOrdinaryMoveIsNeverHeld() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyTicker(ticker(1.00));
        assertThat(state.applyTicker(ticker(1.40))).isTrue();
        assertThat(state.applyTicker(ticker(0.75))).isTrue();
        assertThat(state.rejectedPrices()).isZero();
    }

    @Test
    void theTickerAndTheCandleDisagreeingKeepsTheTickersPrice() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyCandle(new Candle(0, 1.00, 1.01, 0.99, 1.00, 10, false));
        state.applyTicker(ticker(1.00));
        // the candle stream says 40, the ticker keeps saying 1: the candle never gets in
        assertThat(state.applyCandle(new Candle(0, 40, 40, 40, 40, 10, false))).isFalse();
        assertThat(state.applyTicker(ticker(1.00))).isTrue();
        assertThat(state.applyCandle(new Candle(0, 41, 41, 41, 41, 10, false))).isFalse();
        assertThat(state.applyTicker(ticker(1.00))).isTrue();
        SymbolMetrics m = state.toMetrics(30_000);
        assertThat(m.price()).isEqualTo(1.00);
        assertThat(m.high24h()).isLessThan(2);
        assertThat(state.rejectedPrices()).isEqualTo(2);
    }

    @Test
    void zeroAndBrokenPricesNeverGetIn() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyTicker(ticker(1.00));
        assertThat(state.applyTicker(ticker(0))).isFalse();
        assertThat(state.applyTicker(ticker(Double.NaN))).isFalse();
        assertThat(state.toMetrics(30_000).price()).isEqualTo(1.00);
    }

    @Test
    void minutesTheStreamMissedAreReportedOnceForRefilling() {
        SymbolState state = new SymbolState("WIFUSDT");
        state.applyCandle(new Candle(0, 1, 1, 1, 1, 1, true));
        state.applyCandle(new Candle(60_000, 1, 1, 1, 1, 1, false));
        assertThat(state.takeGap()).isFalse();
        // the stream was down for ten minutes
        state.applyCandle(new Candle(12 * 60_000, 1, 1, 1, 1, 1, false));
        assertThat(state.takeGap()).isTrue();
        assertThat(state.takeGap()).as("handed out once").isFalse();
    }
}
