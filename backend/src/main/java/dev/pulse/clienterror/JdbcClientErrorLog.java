package dev.pulse.clienterror;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** One upsert per report: concurrent reports of the same error add up, never race. */
@Repository
class JdbcClientErrorLog implements ClientErrorLog {

    private final JdbcClient jdbc;

    JdbcClientErrorLog(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void count(ClientError e, Instant at) {
        jdbc.sql("""
                        insert into client_error (fingerprint, message, stack, page, build, lang, count, reported, first_seen, last_seen)
                        values (:fp, :message, :stack, :page, :build, :lang, 1, 0, :at, :at)
                        on conflict (fingerprint) do update
                        set count = client_error.count + 1, last_seen = :at, build = :build, lang = :lang
                        """)
                .param("fp", e.fingerprint())
                .param("message", e.message())
                .param("stack", e.stack())
                .param("page", e.page())
                .param("build", e.build())
                .param("lang", e.lang())
                .param("at", Timestamp.from(at))
                .update();
    }

    @Override
    public List<Row> unreported() {
        return jdbc.sql("""
                        select fingerprint, message, stack, page, build, lang, count, count - reported as fresh, first_seen, last_seen
                        from client_error where count > reported order by count - reported desc, last_seen desc
                        """)
                .query((rs, n) -> new Row(rs.getString("fingerprint"), rs.getString("message"), rs.getString("stack"),
                        rs.getString("page"), rs.getString("build"), rs.getString("lang"), rs.getLong("count"), rs.getLong("fresh"),
                        rs.getTimestamp("first_seen").toInstant(), rs.getTimestamp("last_seen").toInstant()))
                .list();
    }

    @Override
    public void reported(List<Row> rows) {
        for (Row r : rows) {
            // only what was told: reports that arrived meanwhile wait for the next summary
            jdbc.sql("update client_error set reported = greatest(reported, :count) where fingerprint = :fp")
                    .param("count", r.count())
                    .param("fp", r.fingerprint())
                    .update();
        }
    }

    @Override
    public int forgetBefore(Instant cutoff) {
        return jdbc.sql("delete from client_error where last_seen < :cutoff").param("cutoff", Timestamp.from(cutoff)).update();
    }
}
