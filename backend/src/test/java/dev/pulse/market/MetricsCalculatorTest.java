package dev.pulse.market;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

class MetricsCalculatorTest {

    private static final long T0 = 1_791_150_000_000L - 1_791_150_000_000L % 300_000; // aligned to a 5m boundary

    @Test
    void changeIsMeasuredFromTheOpenOfTheCandleNMinutesBack() {
        List<Candle> candles = flat(10, 100);
        candles.set(5, candle(5, 95, 96, 94, 96, 1_000)); // the candle that opened 5 minutes ago

        assertThat(MetricsCalculator.changePct(candles, 104.5, 5)).isCloseTo(10.0, within(1e-9));
    }

    @Test
    void changeIsNullWhileHistoryIsTooShort() {
        assertThat(MetricsCalculator.changePct(flat(3, 100), 101, 5)).isNull();
    }

    @Test
    void surgeComparesTheLastFiveMinutesWithTheHourlyPace() {
        List<Candle> candles = new ArrayList<>();
        for (int i = 0; i < 60; i++) {
            candles.add(candle(i, 100, 100, 100, 100, 1_000));
        }
        for (int i = 60; i < 65; i++) {
            candles.add(candle(i, 100, 100, 100, 100, 6_000));
        }

        assertThat(MetricsCalculator.surge(candles)).isCloseTo(6.0, within(1e-9));
    }

    @Test
    void surgeNeedsAtLeastHalfAnHourOfBaseline() {
        assertThat(MetricsCalculator.surge(flat(20, 100))).isNull();
    }

    @Test
    void natrOfConstantRangeBarsEqualsRangeOverPrice() {
        List<Candle> candles = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            candles.add(candle(i, 100, 101, 99, 100, 1_000)); // every 5m bucket ranges 99..101
        }

        assertThat(MetricsCalculator.natr(candles, 14)).isCloseTo(2.0, within(1e-9));
    }

    @Test
    void bucketsAreAlignedToWallClockFiveMinutes() {
        List<Candle> candles = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            candles.add(candle(i, 100 + i, 100 + i + 0.5, 100 + i - 0.5, 100 + i + 0.2, 10));
        }

        List<Candle> buckets = MetricsCalculator.toBuckets(candles, 5);

        assertThat(buckets).hasSize(3);
        assertThat(buckets.get(0).open()).isEqualTo(100);
        assertThat(buckets.get(0).close()).isEqualTo(104.2);
        assertThat(buckets.get(0).high()).isEqualTo(104.5);
        assertThat(buckets.get(0).quoteVolume()).isEqualTo(50);
        assertThat(buckets.get(2).openTime()).isEqualTo(T0 + 10 * 60_000);
    }

    @Test
    void sparklineReturnsTheLastBucketClosesOldestFirst() {
        List<Candle> candles = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            candles.add(candle(i, i, i, i, i, 1));
        }

        // 30 minutes are 6 buckets closing at 4, 9, ..., 29; asking for 3 points keeps the newest
        assertThat(MetricsCalculator.sparkline(candles, 3)).containsExactly(19.0, 24.0, 29.0);
    }

    @Test
    void openInterestChangeUsesTheNewestPointThatIsOldEnough() {
        long now = T0 + 30 * 60_000;
        List<OpenInterestPoint> history = List.of(
                new OpenInterestPoint(now - 20 * 60_000, 900),
                new OpenInterestPoint(now - 16 * 60_000, 1_000),
                new OpenInterestPoint(now - 5 * 60_000, 1_020),
                new OpenInterestPoint(now, 1_058));

        assertThat(MetricsCalculator.openInterestChangePct(history, now, 15)).isCloseTo(5.8, within(1e-9));
    }

    private static List<Candle> flat(int minutes, double price) {
        List<Candle> candles = new ArrayList<>();
        for (int i = 0; i < minutes; i++) {
            candles.add(candle(i, price, price, price, price, 1_000));
        }
        return candles;
    }

    private static Candle candle(int minute, double open, double high, double low, double close, double volume) {
        return new Candle(T0 + minute * 60_000L, open, high, low, close, volume, true);
    }
}
