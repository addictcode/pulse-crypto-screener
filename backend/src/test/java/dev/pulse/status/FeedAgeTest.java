package dev.pulse.status;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.ExchangeStatus;
import dev.pulse.market.Candle;

class FeedAgeTest {

    private static ExchangeAdapter exchange(Long lastFrameAt) {
        return new ExchangeAdapter() {
            @Override
            public String name() {
                return "x";
            }

            @Override
            public List<Candle> candles(String symbol, String interval, int limit) {
                return List.of();
            }

            @Override
            public ExchangeStatus status() {
                return new ExchangeStatus("x", 1, 1, 1, 1, lastFrameAt);
            }
        };
    }

    @Test
    void theNewestFrameOfAnyExchangeCounts() {
        assertThat(new FeedAge(List.of(exchange(1_000L), exchange(9_000L))).at(10_000)).isEqualTo(1_000);
    }

    @Test
    void noFrameYetIsUnknownNotFresh() {
        assertThat(new FeedAge(List.of(exchange(null))).at(10_000)).isNull();
        assertThat(new FeedAge(List.of()).at(10_000)).isNull();
    }

    @Test
    void aFrameStampedAheadOfTheClockIsNotNegative() {
        assertThat(new FeedAge(List.of(exchange(12_000L))).at(10_000)).isZero();
    }

    @Test
    void theHistoryKeepsADay() {
        StatusHistory history = new StatusHistory(new FeedAge(List.of()), null);
        for (int i = 0; i < StatusHistory.MINUTES + 10; i++) {
            history.record(new StatusHistory.Minute(i, 100L, 1, 1));
        }
        assertThat(history.minutes()).hasSize(StatusHistory.MINUTES);
        assertThat(history.minutes().getFirst().t()).isEqualTo(10);
    }
}
