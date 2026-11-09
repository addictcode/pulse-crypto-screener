package dev.pulse.status;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * When Pulse ran. Each start opens an interval and a heartbeat moves its end every minute; the
 * spaces between intervals are downtime. /record/ shows them, and research/live.py leaves out
 * signals whose hour crosses one, so a week with three dead days is not read as a full week.
 *
 * <p>The first start with this table rebuilds the past from the signals themselves: Pulse fires
 * several signals an hour around the clock, so an hour without any means it was not running
 * (the stack on the owner's Mac was down from 2 November, for one).
 */
@Component
public class UptimeLog {

    /** Heartbeats further apart than this are a stop between them, not a slow minute. */
    static final Duration GAP = Duration.ofMinutes(5);
    /** For the past rebuilt from signals: this long without one is downtime. */
    static final Duration SIGNAL_GAP = Duration.ofMinutes(60);
    static final Duration HEARTBEAT = Duration.ofMinutes(1);

    private static final Logger log = LoggerFactory.getLogger(UptimeLog.class);

    public record Interval(Instant from, Instant to) {
    }

    private final JdbcClient jdbc;
    private volatile Long current;

    public UptimeLog(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @EventListener(ApplicationReadyEvent.class)
    void started() {
        start(Instant.now());
    }

    void start(Instant now) {
        Integer rows = jdbc.sql("select count(*) from uptime").query(Integer.class).single();
        if (rows == 0) {
            int rebuilt = rebuildFromSignals(now);
            if (rebuilt > 0) {
                log.info("Uptime: rebuilt {} past intervals from the signal history", rebuilt);
            }
        }
        current = jdbc.sql("insert into uptime (started_at, last_seen_at) values (:at, :at) returning id")
                .param("at", Timestamp.from(now))
                .query(Long.class)
                .single();
    }

    @Scheduled(fixedRate = 60_000, initialDelay = 60_000)
    void heartbeat() {
        beat(Instant.now());
    }

    void beat(Instant now) {
        Long id = current;
        if (id != null) {
            jdbc.sql("update uptime set last_seen_at = :at where id = :id").param("at", Timestamp.from(now)).param("id", id).update();
        }
    }

    /** Past intervals from stored signals: runs of signals with no gap longer than {@link #SIGNAL_GAP}. */
    int rebuildFromSignals(Instant before) {
        List<Instant> times = jdbc.sql("select fired_at from signal where fired_at < :before order by fired_at")
                .param("before", Timestamp.from(before))
                .query((rs, n) -> rs.getTimestamp(1).toInstant())
                .list();
        List<Interval> runs = new ArrayList<>();
        Instant from = null;
        Instant to = null;
        for (Instant t : times) {
            if (from == null) {
                from = t;
            } else if (Duration.between(to, t).compareTo(SIGNAL_GAP) > 0) {
                runs.add(new Interval(from, to));
                from = t;
            }
            to = t;
        }
        if (from != null) {
            // signals until just before this start: it was running until now and only restarted
            runs.add(new Interval(from, Duration.between(to, before).compareTo(SIGNAL_GAP) <= 0 ? before : to));
        }
        for (Interval r : runs) {
            jdbc.sql("insert into uptime (started_at, last_seen_at) values (:from, :to)")
                    .param("from", Timestamp.from(r.from()))
                    .param("to", Timestamp.from(r.to()))
                    .update();
        }
        return runs.size();
    }

    /** When Pulse ran within [from, to], overlapping runs merged, oldest first. */
    public List<Interval> running(Instant from, Instant to) {
        List<Interval> rows = jdbc.sql("""
                        select started_at, last_seen_at from uptime
                        where last_seen_at >= :from and started_at <= :to order by started_at
                        """)
                .param("from", Timestamp.from(from))
                .param("to", Timestamp.from(to))
                .query((rs, n) -> new Interval(rs.getTimestamp(1).toInstant(), rs.getTimestamp(2).toInstant()))
                .list();
        List<Interval> merged = new ArrayList<>();
        for (Interval r : rows) {
            Interval clipped = new Interval(r.from().isBefore(from) ? from : r.from(), r.to().isAfter(to) ? to : r.to());
            if (!merged.isEmpty() && !clipped.from().isAfter(merged.getLast().to().plus(GAP))) {
                Interval last = merged.removeLast();
                merged.add(new Interval(last.from(), clipped.to().isAfter(last.to()) ? clipped.to() : last.to()));
            } else {
                merged.add(clipped);
            }
        }
        return merged;
    }

    /**
     * The spaces between runs within [from, to] longer than {@link #GAP}: when Pulse was not
     * running. Time before the first run ever is not downtime: Pulse did not exist yet.
     */
    public List<Interval> down(Instant from, Instant to) {
        Instant first = jdbc.sql("select min(started_at) from uptime").query((rs, n) -> {
            java.sql.Timestamp t = rs.getTimestamp(1);
            return t == null ? null : t.toInstant();
        }).single();
        if (first == null) {
            return List.of();
        }
        if (first.isAfter(from)) {
            from = first;
        }
        List<Interval> runs = running(from, to);
        List<Interval> gaps = new ArrayList<>();
        Instant cursor = from;
        for (Interval r : runs) {
            if (Duration.between(cursor, r.from()).compareTo(GAP) > 0) {
                gaps.add(new Interval(cursor, r.from()));
            }
            cursor = r.to().isAfter(cursor) ? r.to() : cursor;
        }
        // while Pulse runs, its run ends now, not at its last heartbeat a minute ago
        if (current == null && Duration.between(cursor, to).compareTo(GAP) > 0) {
            gaps.add(new Interval(cursor, to));
        }
        return gaps;
    }
}
