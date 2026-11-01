package dev.pulse.visit;

import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Counters in PostgreSQL. One upsert per hit: concurrent hits on the same row add up instead of
 * racing a read-modify-write, and a new day or source needs no setup.
 */
@Repository
class JdbcVisitLog implements VisitLog {

    private final JdbcClient jdbc;

    JdbcVisitLog(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void count(LocalDate day, FunnelStep step, VisitSource source) {
        jdbc.sql("""
                        insert into visit_day (day, page, source, count) values (:day, :page, :source, 1)
                        on conflict (day, page, source) do update set count = visit_day.count + 1
                        """)
                .param("day", day)
                .param("page", step.key())
                .param("source", source.key())
                .update();
    }

    @Override
    public List<VisitCount> since(LocalDate from) {
        return jdbc.sql("select day, page, source, count from visit_day where day >= :from order by day, page, source")
                .param("from", from)
                .query((rs, n) -> {
                    // rows written by an older or newer version with a step this one does not know are skipped
                    Optional<FunnelStep> step = FunnelStep.fromKey(rs.getString("page"));
                    Optional<VisitSource> source = VisitSource.fromKey(rs.getString("source"));
                    return step.isPresent() && source.isPresent()
                            ? new VisitCount(rs.getObject("day", LocalDate.class), step.get(), source.get(), rs.getLong("count"))
                            : null;
                })
                .list()
                .stream()
                .filter(Objects::nonNull)
                .toList();
    }
}
