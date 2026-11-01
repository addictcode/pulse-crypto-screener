package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;

import org.junit.jupiter.api.Test;

import dev.pulse.visit.FunnelStep;
import dev.pulse.visit.VisitCount;
import dev.pulse.visit.VisitSource;

class VisitReportTest {

    private static final LocalDate MONDAY = LocalDate.of(2026, 11, 2);

    @Test
    void showsTheFunnelByDayAndBySource() {
        String report = VisitReport.format(List.of(
                new VisitCount(MONDAY, FunnelStep.LANDING, VisitSource.TIKTOK, 40),
                new VisitCount(MONDAY, FunnelStep.LANDING, VisitSource.DIRECT, 5),
                new VisitCount(MONDAY, FunnelStep.APP, VisitSource.TIKTOK, 12),
                new VisitCount(MONDAY.plusDays(1), FunnelStep.RECORD, VisitSource.GOOGLE, 3)), 7);

        assertThat(report).contains("last 7 d");
        // nobody reached the clip or the bot: those columns are left out
        assertThat(report).contains("site  app  rec").doesNotContain("clip").doesNotContain("→bot");
        assertThat(report).contains("11-02      45   12    0");
        assertThat(report).contains("11-03       0    0    3");
        assertThat(report).contains("total      45   12    3");
        assertThat(report).contains("tiktok     40   12    0");
        assertThat(report).contains("google      0    0    3");
        // sources in their fixed order, not alphabetical
        assertThat(report.indexOf("tiktok")).isLessThan(report.indexOf("google"));
        assertThat(report.indexOf("google")).isLessThan(report.indexOf("direct"));
    }

    @Test
    void anEmptyPeriodSaysSo() {
        assertThat(VisitReport.format(List.of(), 30)).isEqualTo("No visits in the last 30 d yet.");
    }

    @Test
    void readsThePeriod() {
        assertThat(VisitReport.days(null)).isEqualTo(7);
        assertThat(VisitReport.days("30")).isEqualTo(30);
        assertThat(VisitReport.days("14d")).isEqualTo(14);
        assertThat(VisitReport.days("1000")).isEqualTo(90);
        assertThat(VisitReport.days("0")).isEqualTo(1);
        assertThat(VisitReport.days("week")).isEqualTo(7);
        // today counts as one of the days
        assertThat(VisitReport.from(MONDAY, 7)).isEqualTo(MONDAY.minusDays(6));
    }
}
