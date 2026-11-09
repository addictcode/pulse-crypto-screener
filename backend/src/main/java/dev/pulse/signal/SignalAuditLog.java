package dev.pulse.signal;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Each night's check of signals against the exchange's candles, one row a run. */
@Repository
public class SignalAuditLog {

    /**
     * @param checked   signals the candles could speak for (some fall where the exchange has no candles)
     * @param confirmed of those, the ones the candles agree with
     */
    public record Totals(int days, int checked, int confirmed, Instant lastRun) {
        public int failed() {
            return checked - confirmed;
        }
    }

    private final JdbcClient jdbc;

    SignalAuditLog(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void record(Instant at, int sampled, int checked, int confirmed, String failures) {
        jdbc.sql("""
                        insert into signal_audit (checked_at, sampled, checked, confirmed, failures)
                        values (:at, :sampled, :checked, :confirmed, :failures)
                        """)
                .param("at", Timestamp.from(at))
                .param("sampled", sampled)
                .param("checked", checked)
                .param("confirmed", confirmed)
                .param("failures", failures.length() > 2000 ? failures.substring(0, 2000) : failures)
                .update();
    }

    /** All runs since then, added up. */
    public Totals since(Instant from, int days) {
        return jdbc.sql("""
                        select coalesce(sum(checked), 0) as checked, coalesce(sum(confirmed), 0) as confirmed, max(checked_at) as last
                        from signal_audit where checked_at >= :from
                        """)
                .param("from", Timestamp.from(from))
                .query((rs, n) -> new Totals(days, rs.getInt("checked"), rs.getInt("confirmed"),
                        Optional.ofNullable(rs.getTimestamp("last")).map(Timestamp::toInstant).orElse(null)))
                .single();
    }
}
