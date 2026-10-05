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
}
