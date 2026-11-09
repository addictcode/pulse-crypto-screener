package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.market.Candle;

class CandleCheckTest {

    static final long T0 = 1_762_000_000_000L - 1_762_000_000_000L % 60_000;

    /** Flat minute candles around a price, with a ramp of {@code rise} over the last five minutes. */
    static List<Candle> candles(double price, double rise) {
        List<Candle> out = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            double p = i < 25 ? price : price * (1 + rise * (i - 24) / 5);
            out.add(new Candle(T0 + i * 60_000L, p, p * 1.001, p * 0.999, p, 1_000, true));
        }
        return out;
    }

    private static long minute(int i) {
        return T0 + i * 60_000L + 30_000;
    }

    @Test
    void aRealPumpIsConfirmed() {
        List<Candle> c = candles(100, 0.03);
        double price = c.get(29).close();
        assertThat(CandleCheck.check(SignalType.PUMP, price, 2.8, minute(29), c).verdict()).isEqualTo(CandleCheck.Verdict.CONFIRMED);
    }

    @Test
    void aSplicedPriceFails() {
        // the October 2026 bug: the price of another coin, glued to this one
        List<Candle> c = candles(100, 0);
        CandleCheck.Result r = CandleCheck.check(SignalType.VOLUME, 3_400, 5, minute(20), c);
        assertThat(r.verdict()).isEqualTo(CandleCheck.Verdict.FAILED);
        assertThat(r.reason()).contains("outside the candles");
    }

    @Test
    void aPumpTheCandlesDoNotShowFails() {
        List<Candle> c = candles(100, 0.002);
        double price = c.get(29).close();
        CandleCheck.Result r = CandleCheck.check(SignalType.PUMP, price, 4.0, minute(29), c);
        assertThat(r.verdict()).isEqualTo(CandleCheck.Verdict.FAILED);
        assertThat(r.reason()).contains("the signal says +4.0%");
    }

    @Test
    void aDumpIsCheckedTheOtherWay() {
        List<Candle> c = candles(100, -0.03);
        double price = c.get(29).close();
        assertThat(CandleCheck.check(SignalType.DUMP, price, 2.9, minute(29), c).verdict()).isEqualTo(CandleCheck.Verdict.CONFIRMED);
        assertThat(CandleCheck.check(SignalType.PUMP, price, 2.9, minute(29), c).verdict()).isEqualTo(CandleCheck.Verdict.FAILED);
    }

    @Test
    void aSignalWithoutCandlesIsNotJudged() {
        List<Candle> c = candles(100, 0);
        assertThat(CandleCheck.check(SignalType.PUMP, 100, 2, minute(2), c).verdict()).isEqualTo(CandleCheck.Verdict.UNCHECKED);
        assertThat(CandleCheck.check(SignalType.PUMP, 100, 2, minute(400), c).verdict()).isEqualTo(CandleCheck.Verdict.UNCHECKED);
    }

    @Test
    void aTickerAHairOutsideTheCandleIsFine() {
        List<Candle> c = candles(100, 0);
        assertThat(CandleCheck.check(SignalType.FUNDING, 100.4, 0.2, minute(20), c).verdict()).isEqualTo(CandleCheck.Verdict.CONFIRMED);
    }
}
