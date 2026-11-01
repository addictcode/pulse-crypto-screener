package dev.pulse.visit;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;

@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class JdbcVisitLogIT {

    /** Far from today, so rows other tests write do not mix in. */
    private static final LocalDate DAY = LocalDate.of(2001, 1, 1);

    @Autowired
    private VisitLog visits;

    @Test
    void hitsOnTheSameRowAddUp() {
        visits.count(DAY, FunnelStep.LANDING, VisitSource.TIKTOK);
        visits.count(DAY, FunnelStep.LANDING, VisitSource.TIKTOK);
        visits.count(DAY, FunnelStep.LANDING, VisitSource.DIRECT);
        visits.count(DAY.plusDays(1), FunnelStep.BOT_START, VisitSource.TIKTOK);

        assertThat(visits.since(DAY)).filteredOn(r -> r.day().isBefore(DAY.plusDays(2))).containsExactly(
                new VisitCount(DAY, FunnelStep.LANDING, VisitSource.DIRECT, 1),
                new VisitCount(DAY, FunnelStep.LANDING, VisitSource.TIKTOK, 2),
                new VisitCount(DAY.plusDays(1), FunnelStep.BOT_START, VisitSource.TIKTOK, 1));
        assertThat(visits.since(DAY.plusDays(1))).noneMatch(r -> r.day().equals(DAY));
    }
}
