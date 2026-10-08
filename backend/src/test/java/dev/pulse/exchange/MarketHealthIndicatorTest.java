package dev.pulse.exchange;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Status;

import dev.pulse.config.PulseProperties;
import dev.pulse.market.Candle;

class MarketHealthIndicatorTest {

    private static final PulseProperties PROPERTIES = new PulseProperties(
            new PulseProperties.Binance(true, "", "", "", 1, 2000, 120, 800, 15, Duration.ofSeconds(60), Duration.ofSeconds(30)),
            null, null, null, null, null);

    @Test
    void aFeedThatTalksIsUp() {
        assertThat(health(status(525, 1, System.currentTimeMillis() - 2_000)).getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void aSilentFeedTakesTheServiceOut() {
        var health = health(status(525, 1, System.currentTimeMillis() - 5 * 60_000));

        assertThat(health.getStatus()).isEqualTo(Status.OUT_OF_SERVICE);
        assertThat(health.getDetails().get("binance").toString()).contains("silent");
    }

    @Test
    void closedConnectionsCountAsSilence() {
        assertThat(health(status(525, 0, System.currentTimeMillis())).getStatus()).isEqualTo(Status.OUT_OF_SERVICE);
    }

    @Test
    void startingUpIsNotAFailure() {
        assertThat(health(status(0, 0, null)).getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void noExchangesConfiguredIsUp() {
        assertThat(new MarketHealthIndicator(List.of(), PROPERTIES).health().getStatus()).isEqualTo(Status.UP);
    }

    private static org.springframework.boot.health.contributor.Health health(ExchangeStatus status) {
        ExchangeAdapter adapter = new ExchangeAdapter() {
            @Override
            public String name() {
                return "binance";
            }

            @Override
            public List<Candle> candles(String symbol, String interval, int limit) {
                return List.of();
            }

            @Override
            public ExchangeStatus status() {
                return status;
            }
        };
        return new MarketHealthIndicator(List.of(adapter), PROPERTIES).health();
    }

    private static ExchangeStatus status(int symbols, int open, Long lastFrameAt) {
        return new ExchangeStatus("binance", symbols, symbols, 1, open, lastFrameAt);
    }
}
