package dev.pulse.signal;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.config.OwnerNotice;
import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.exchange.ExchangeStatus;
import dev.pulse.market.Candle;

/**
 * The night watch on made-up data: signals stored with prices the candles agree with pass quietly;
 * the same day with spliced prices, as in October 2026, raises the alarm.
 */
@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false"})
@Import(TestcontainersConfiguration.class)
class SignalAuditIT {

    @Autowired
    private SignalRepository repository;
    @Autowired
    private SignalHistory history;
    @Autowired
    private SignalAuditLog audits;

    /** Every pair trades flat at 100 in the candles. */
    private static ExchangeAdapter exchange(long end) {
        return new ExchangeAdapter() {
            @Override
            public String name() {
                return "test";
            }

            @Override
            public List<Candle> candles(String symbol, String interval, int limit) {
                List<Candle> out = new ArrayList<>();
                long last = end - end % 60_000;
                for (int i = limit - 1; i >= 0; i--) {
                    out.add(new Candle(last - i * 60_000L, 100, 100.1, 99.9, 100, 1, true));
                }
                return out;
            }

            @Override
            public ExchangeStatus status() {
                return null;
            }
        };
    }

    private SignalAudit audit(Instant now, List<Object> told) {
        return new SignalAudit(repository, List.of(exchange(now.toEpochMilli())), audits, told::add,
                true, 40, 25, 0.1, 10, Clock.fixed(now, ZoneOffset.UTC), new Random(1));
    }

    @Test
    void splicedPricesRaiseTheAlarmAndCleanOnesDoNot() {
        // far in the future, so other tests' signals stay out of the day being checked
        Instant now = Instant.parse("2031-01-01T06:21:00Z");
        long base = now.minusSeconds(3 * 3600).toEpochMilli();
        for (int i = 0; i < 12; i++) {
            history.record(new Signal(null, SignalType.VOLUME, "AUDIT%02dUSDT".formatted(i), base + i * 60_000L, 100.05, 5, "t", "d"));
        }
        List<Object> told = new ArrayList<>();
        SignalAudit.Run clean = audit(now, told).run();
        assertThat(clean.checked()).isEqualTo(12);
        assertThat(clean.confirmed()).isEqualTo(12);
        assertThat(told).isEmpty();

        // the next day, a third of the prices belong to another coin
        Instant next = now.plusSeconds(24 * 3600);
        long nextBase = next.minusSeconds(3 * 3600).toEpochMilli();
        for (int i = 0; i < 12; i++) {
            double price = i % 3 == 0 ? 3_412.5 : 100.02;
            history.record(new Signal(null, SignalType.VOLUME, "AUDIT%02dUSDT".formatted(i), nextBase + i * 60_000L, price, 5, "t", "d"));
        }
        SignalAudit.Run spliced = audit(next, told).run();
        assertThat(spliced.checked()).isEqualTo(12);
        assertThat(spliced.confirmed()).isEqualTo(8);
        assertThat(told).singleElement().satisfies(n -> assertThat(((OwnerNotice) n).text())
                .contains("4 not").contains("outside the candles"));

        SignalAuditLog.Totals totals = audits.since(now.minusSeconds(60), 2);
        assertThat(totals.checked()).isEqualTo(24);
        assertThat(totals.confirmed()).isEqualTo(20);
        assertThat(totals.lastRun()).isEqualTo(next);
    }
}
