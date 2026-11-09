package dev.pulse.signal;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The outcome statistics per UTC day, type and direction, so /record/ and the bot add up 90 rows
 * a type instead of scanning every signal of 90 days (123 ms at a million rows, on every visit).
 * A day is rolled up once its last hour is measured, at 01:31 the next morning, and once more the
 * night after in case an outcome came late; the first start rolls up all the days before.
 */
@Component
public class SignalRollup {

    private static final Logger log = LoggerFactory.getLogger(SignalRollup.class);

    private final JdbcClient jdbc;
    private final TransactionTemplate tx;

    public SignalRollup(JdbcClient jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    /** Sums, not averages: days add up. */
    record Day(SignalType type, int direction, long n5, double s5, long u5, long n15, double s15, long u15,
               long n60, double s60, long u60) {
    }

    @Scheduled(cron = "0 31 1 * * *", zone = "UTC")
    void nightly() {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        roll(today.minusDays(1));
        roll(today.minusDays(2));
    }

    @EventListener(ApplicationReadyEvent.class)
    void backfill() {
        Thread.ofVirtual().name("signal-rollup").start(() -> {
            try {
                int days = backfillBefore(LocalDate.now(ZoneOffset.UTC));
                if (days > 0) {
                    log.info("Signal rollup: {} past days rolled up", days);
                }
            } catch (RuntimeException e) {
                log.warn("Signal rollup backfill failed: {}", e.toString());
            }
        });
    }

    /** Rolls up every day before {@code today} that has signals and no rollup yet. */
    int backfillBefore(LocalDate today) {
        List<LocalDate> missing = jdbc.sql("""
                        select distinct (fired_at at time zone 'UTC')::date as day from signal
                        where fired_at < :today
                        and (fired_at at time zone 'UTC')::date not in (select day from signal_day_rolled)
                        order by day
                        """)
                .param("today", Timestamp.from(start(today)))
                .query((rs, n) -> rs.getDate(1).toLocalDate())
                .list();
        missing.forEach(this::roll);
        return missing.size();
    }

    /** (Re)computes one day; idempotent. */
    void roll(LocalDate day) {
        tx.executeWithoutResult(status -> {
            jdbc.sql("delete from signal_day where day = :day").param("day", Date.valueOf(day)).update();
            jdbc.sql("""
                            insert into signal_day (day, type, direction, n5, s5, u5, n15, s15, u15, n60, s60, u60)
                            select :day, type, direction,
                                count(ret_5m), coalesce(sum(ret_5m), 0), count(*) filter (where ret_5m > 0),
                                count(ret_15m), coalesce(sum(ret_15m), 0), count(*) filter (where ret_15m > 0),
                                count(ret_1h), coalesce(sum(ret_1h), 0), count(*) filter (where ret_1h > 0)
                            from signal where fired_at >= :from and fired_at < :to
                            group by type, direction
                            """)
                    .param("day", Date.valueOf(day))
                    .param("from", Timestamp.from(start(day)))
                    .param("to", Timestamp.from(start(day.plusDays(1))))
                    .update();
            jdbc.sql("insert into signal_day_rolled (day) values (:day) on conflict do nothing").param("day", Date.valueOf(day)).update();
        });
    }

    /** Whether every day in [first, last] is rolled up. */
    boolean covers(LocalDate first, LocalDate last) {
        if (last.isBefore(first)) {
            return true;
        }
        long expected = first.datesUntil(last.plusDays(1)).count();
        Long rolled = jdbc.sql("select count(*) from signal_day_rolled where day between :first and :last")
                .param("first", Date.valueOf(first))
                .param("last", Date.valueOf(last))
                .query(Long.class)
                .single();
        return rolled == expected;
    }

    /** The rolled-up days [first, last] added up per type and direction. */
    Map<String, Day> sum(LocalDate first, LocalDate last) {
        Map<String, Day> out = new HashMap<>();
        jdbc.sql("""
                        select type, direction, sum(n5), sum(s5), sum(u5), sum(n15), sum(s15), sum(u15), sum(n60), sum(s60), sum(u60)
                        from signal_day where day between :first and :last group by type, direction
                        """)
                .param("first", Date.valueOf(first))
                .param("last", Date.valueOf(last))
                .query((rs, n) -> new Day(SignalType.valueOf(rs.getString(1)), rs.getInt(2),
                        rs.getLong(3), rs.getDouble(4), rs.getLong(5), rs.getLong(6), rs.getDouble(7), rs.getLong(8),
                        rs.getLong(9), rs.getDouble(10), rs.getLong(11)))
                .list()
                .forEach(d -> out.put(d.type() + "/" + d.direction(), d));
        return out;
    }

    static Instant start(LocalDate day) {
        return day.atStartOfDay(ZoneOffset.UTC).toInstant();
    }
}
