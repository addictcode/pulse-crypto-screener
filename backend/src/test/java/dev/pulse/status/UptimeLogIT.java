package dev.pulse.status;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.SignalType;

@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class UptimeLogIT {

    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private SignalHistory history;

    private static Instant at(String s) {
        return Instant.parse(s);
    }

    /**
     * The real case: the stack on the owner's Mac fired signals until 2 November and stood still until
     * the 5th. The first start with the uptime table finds that gap in the signal history.
     */
    @Test
    void theDowntimeFromTheSecondOfNovemberIsRebuiltFromTheSignals() {
        jdbc.sql("delete from uptime").update();
        for (Instant t = at("2026-10-31T00:00:00Z"); t.isBefore(at("2026-11-02T14:00:00Z")); t = t.plusSeconds(900)) {
            history.record(new Signal(null, SignalType.VOLUME, "UPTIMEUSDT", t.toEpochMilli(), 1, 5, "t", "d"));
        }
        for (Instant t = at("2026-11-05T09:00:00Z"); t.isBefore(at("2026-11-06T00:00:00Z")); t = t.plusSeconds(900)) {
            history.record(new Signal(null, SignalType.VOLUME, "UPTIMEUSDT", t.toEpochMilli(), 1, 5, "t", "d"));
        }
        UptimeLog uptime = new UptimeLog(jdbc);
        uptime.start(at("2026-11-06T00:00:00Z"));

        List<UptimeLog.Interval> down = uptime.down(at("2026-10-31T00:00:00Z"), at("2026-11-06T00:00:00Z"));
        assertThat(down).containsExactly(new UptimeLog.Interval(at("2026-11-02T13:45:00Z"), at("2026-11-05T09:00:00Z")));
    }

    @Test
    void heartbeatsMakeOneRunAndAStopBetweenStartsIsDowntime() {
        // the first run written as it would be after an hour of heartbeats (a start on an empty table
        // would rebuild the past from the signals other tests stored)
        jdbc.sql("delete from uptime").update();
        jdbc.sql("insert into uptime (started_at, last_seen_at) values ('2030-01-01T00:00:00Z', '2030-01-01T01:00:00Z')").update();
        UptimeLog second = new UptimeLog(jdbc);
        second.start(at("2030-01-01T03:00:00Z"));
        second.beat(at("2030-01-01T04:00:00Z"));
        // a restart a minute later is not downtime
        UptimeLog third = new UptimeLog(jdbc);
        third.start(at("2030-01-01T04:01:00Z"));
        third.beat(at("2030-01-01T05:00:00Z"));

        assertThat(third.running(at("2030-01-01T00:00:00Z"), at("2030-01-01T05:00:00Z"))).containsExactly(
                new UptimeLog.Interval(at("2030-01-01T00:00:00Z"), at("2030-01-01T01:00:00Z")),
                new UptimeLog.Interval(at("2030-01-01T03:00:00Z"), at("2030-01-01T05:00:00Z")));
        // the hour before the first run ever is not downtime: there was no Pulse yet
        assertThat(third.down(at("2029-12-31T23:00:00Z"), at("2030-01-01T05:00:00Z"))).containsExactly(
                new UptimeLog.Interval(at("2030-01-01T01:00:00Z"), at("2030-01-01T03:00:00Z")));
    }
}
