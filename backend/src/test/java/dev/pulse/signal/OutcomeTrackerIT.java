package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.market.Candle;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarketStore;

/**
 * Outcomes against a real database: the tracker fills them in, the statistics query adds them up.
 */
@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class OutcomeTrackerIT {

    @Autowired
    private SignalHistory history;
    @Autowired
    private MarketStore market;
    @Autowired
    private ApplicationEventPublisher events;

    @Test
    void measuresOnlyTheHorizonsThatJustPassed() {
        Instant now = Instant.now();
        market.onInstruments(List.of(new Instrument("OUTAUSDT", "OUTA", "USDT")));
        market.onCandle("OUTAUSDT", new Candle(now.toEpochMilli(), 110, 110, 110, 110, 1, false));
        Signal due = fire("OUTAUSDT", SignalType.PUMP, 1, now.minus(Duration.ofMinutes(5)).minusSeconds(10), 100);
        Signal early = fire("OUTAUSDT", SignalType.PUMP, 1, now.minus(Duration.ofMinutes(3)), 100);
        Signal missed = fire("OUTAUSDT", SignalType.PUMP, 1, now.minus(Duration.ofMinutes(40)), 100);

        new OutcomeTracker(history, market, events).measure(now);

        assertThat(stored(due).ret5m()).isEqualTo(10.0);
        assertThat(stored(due).ret15m()).isNull();
        assertThat(stored(early).ret5m()).isNull();
        // its 5 and 15 minute marks passed long ago: better no number than a wrong one
        assertThat(stored(missed).ret5m()).isNull();
        assertThat(stored(missed).ret15m()).isNull();
        assertThat(history.recent(SignalHistory.CACHED)).filteredOn(s -> s.id().equals(due.id()))
                .extracting(Signal::ret5m).containsExactly(10.0);
    }

    @Test
    void statisticsGroupByTypeAndDirection() {
        Instant now = Instant.now();
        Signal a = fire("OUTBUSDT", SignalType.LIQUIDATIONS, -1, now.minusSeconds(30), 100);
        Signal b = fire("OUTBUSDT", SignalType.LIQUIDATIONS, -1, now.minusSeconds(20), 100);
        Signal c = fire("OUTBUSDT", SignalType.LIQUIDATIONS, -1, now.minusSeconds(10), 100);
        history.recordOutcomes(Horizon.M5, java.util.Map.of(a.id(), 2.0, b.id(), 1.0, c.id(), -6.0));
        history.recordOutcomes(Horizon.H1, java.util.Map.of(a.id(), 4.0));

        OutcomeStats longs = history.outcomes(now.minus(Duration.ofDays(1))).stream()
                .filter(s -> s.type() == SignalType.LIQUIDATIONS && s.direction() == -1)
                .findFirst().orElseThrow();

        assertThat(longs.label()).isEqualTo("Longs liquidated");
        OutcomeStats.Cell fiveMinutes = longs.horizons().get(0);
        assertThat(fiveMinutes.n()).isGreaterThanOrEqualTo(3);
        OutcomeStats.Cell hour = longs.horizons().get(2);
        assertThat(hour.n()).isGreaterThanOrEqualTo(1);
        assertThat(hour.upShare()).isGreaterThan(0);
        assertThat(longs.horizons().get(1).avg()).isNull();
    }

    private Signal fire(String symbol, SignalType type, int direction, Instant at, double price) {
        return history.record(new Signal(null, type, symbol, at.toEpochMilli(), price, 3, "t", "d").withDirection(direction));
    }

    private Signal stored(Signal signal) {
        return history.recentFor(signal.symbol(), 50).stream().filter(s -> s.id().equals(signal.id())).findFirst().orElseThrow();
    }
}
