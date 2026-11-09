package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import dev.pulse.TestcontainersConfiguration;

/** The daily rollup adds up to exactly what the signals themselves say. */
@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class SignalRollupIT {

    @Autowired
    private SignalHistory history;
    @Autowired
    private SignalRollup rollup;
    @Autowired
    private JdbcClient jdbc;

    @Test
    void wholeDaysFromTheRollupAndTheEdgesFromTheSignalsMatchTheRawCount() {
        // in 2032, apart from every other test's signals
        Random random = new Random(3);
        SignalType[] types = {SignalType.PUMP, SignalType.DUMP, SignalType.VOLUME};
        Instant t0 = Instant.parse("2032-03-01T00:00:00Z");
        for (int i = 0; i < 9 * 24 * 4; i++) {
            Instant at = t0.plusSeconds(i * 900L + random.nextInt(600));
            SignalType type = types[i % 3];
            Signal s = history.record(new Signal(null, type, "ROLLUSDT", at.toEpochMilli(), 1, 3, "t", "d")
                    .withDirection(i % 2 == 0 ? 1 : -1));
            // some outcomes measured, some not: count() must skip the empty ones the same way
            jdbc.sql("update signal set ret_5m = :a, ret_15m = :b, ret_1h = :c where id = :id")
                    .param("a", random.nextGaussian())
                    .param("b", i % 5 == 0 ? null : random.nextGaussian())
                    .param("c", i % 7 == 0 ? null : random.nextGaussian())
                    .param("id", s.id())
                    .update();
        }
        for (LocalDate d = LocalDate.parse("2032-03-01"); d.isBefore(LocalDate.parse("2032-03-10")); d = d.plusDays(1)) {
            rollup.roll(d);
        }
        Instant since = Instant.parse("2032-03-01T13:20:00Z");
        Instant now = Instant.parse("2032-03-09T18:00:00Z");
        assertThat(rollup.covers(LocalDate.parse("2032-03-02"), LocalDate.parse("2032-03-08"))).isTrue();

        List<OutcomeRow> rolled = sorted(history.rows(since, now));
        List<OutcomeRow> raw = sorted(history.rows(since, now).isEmpty() ? List.of() : rawRows(since, now));
        assertThat(rolled).hasSameSizeAs(raw).isNotEmpty();
        for (int i = 0; i < raw.size(); i++) {
            OutcomeRow a = rolled.get(i);
            OutcomeRow b = raw.get(i);
            assertThat(a.type()).isEqualTo(b.type());
            assertThat(a.direction()).isEqualTo(b.direction());
            assertThat(a.n5m()).isEqualTo(b.n5m());
            assertThat(a.n15m()).isEqualTo(b.n15m());
            assertThat(a.n1h()).isEqualTo(b.n1h());
            assertThat(a.up5m()).isEqualTo(b.up5m());
            assertThat(a.up1h()).isEqualTo(b.up1h());
            assertThat(a.avg5m()).isCloseTo(b.avg5m(), within(1e-9));
            assertThat(a.avg15m()).isCloseTo(b.avg15m(), within(1e-9));
            assertThat(a.avg1h()).isCloseTo(b.avg1h(), within(1e-9));
        }
    }

    @Test
    void withoutTheRollupTheSignalsAreCountedDirectly() {
        // a period whose days were never rolled up falls back to the plain query
        assertThat(rollup.covers(LocalDate.parse("2033-01-01"), LocalDate.parse("2033-01-03"))).isFalse();
        assertThat(history.rows(Instant.parse("2033-01-01T00:00:00Z"), Instant.parse("2033-01-05T00:00:00Z"))).isEmpty();
    }

    @Autowired
    private SignalRepository repository;

    private List<OutcomeRow> rawRows(Instant since, Instant now) {
        return repository.outcomesBetween(since, now.plusMillis(1));
    }

    private static List<OutcomeRow> sorted(List<OutcomeRow> rows) {
        return rows.stream().sorted(Comparator.comparing((OutcomeRow r) -> r.type().name()).thenComparing(OutcomeRow::direction)).toList();
    }
}
