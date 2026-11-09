package dev.pulse.signal;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.OwnerNotice;
import dev.pulse.exchange.ExchangeAdapter;
import dev.pulse.market.Candle;

/**
 * The night watch over the signals: a random sample of the last day's signals is checked against
 * the exchange's own minute candles ({@link CandleCheck}). The share the candles do not confirm
 * goes into {@code signal_audit} and onto /record/; above {@link #alarmShare} the owner hears of it
 * at once. In October 2026 two sockets wrote into one buffer and two thirds of the pumps and dumps
 * carried another coin's price for two weeks before anyone saw it; with this, a day.
 */
@Component
public class SignalAudit {

    private static final Logger log = LoggerFactory.getLogger(SignalAudit.class);
    /** Binance gives at most 1500 minute candles a request: a day and an hour. */
    static final int CANDLES = 1500;
    static final Duration LOOKBACK = Duration.ofHours(24);
    /** The minute of the signal must be over, and the candle with it. */
    static final Duration SETTLE = Duration.ofMinutes(2);

    private final SignalRepository signals;
    private final List<ExchangeAdapter> exchanges;
    private final SignalAuditLog audits;
    private final ApplicationEventPublisher events;
    private final boolean enabled;
    private final int sample;
    private final int maxSymbols;
    private final double alarmShare;
    private final int minChecked;
    private final Clock clock;
    private final Random random;

    @Autowired
    SignalAudit(SignalRepository signals, List<ExchangeAdapter> exchanges, SignalAuditLog audits, ApplicationEventPublisher events,
                @Value("${pulse.audit.enabled:true}") boolean enabled,
                @Value("${pulse.audit.sample:40}") int sample,
                @Value("${pulse.audit.max-symbols:25}") int maxSymbols,
                @Value("${pulse.audit.alarm-share:0.1}") double alarmShare,
                @Value("${pulse.audit.min-checked:10}") int minChecked) {
        this(signals, exchanges, audits, events, enabled, sample, maxSymbols, alarmShare, minChecked, Clock.systemUTC(), new Random());
    }

    SignalAudit(SignalRepository signals, List<ExchangeAdapter> exchanges, SignalAuditLog audits, ApplicationEventPublisher events,
                boolean enabled, int sample, int maxSymbols, double alarmShare, int minChecked, Clock clock, Random random) {
        this.signals = signals;
        this.exchanges = exchanges;
        this.audits = audits;
        this.events = events;
        this.enabled = enabled;
        this.sample = sample;
        this.maxSymbols = maxSymbols;
        this.alarmShare = alarmShare;
        this.minChecked = minChecked;
        this.clock = clock;
        this.random = random;
    }

    /** What one run found. */
    record Run(int sampled, int checked, int confirmed, List<String> failures) {
    }

    /** 06:21 UTC, before the client error summary: the morning brings both. */
    @Scheduled(cron = "${pulse.audit.cron:0 21 6 * * *}", zone = "UTC")
    public void nightly() {
        if (!enabled || exchanges.isEmpty()) {
            return;
        }
        try {
            run();
        } catch (RuntimeException e) {
            log.warn("Signal audit failed: {}", e.toString());
        }
    }

    Run run() {
        Instant now = clock.instant();
        List<SignalEntity> day = new ArrayList<>(signals.findByFiredAtAfterOrderByFiredAtAsc(now.minus(LOOKBACK)).stream()
                .filter(s -> s.getFiredAt().isBefore(now.minus(SETTLE)))
                .toList());
        Collections.shuffle(day, random);
        // a sample spread over pairs, each pair's candles fetched once
        Map<String, List<SignalEntity>> bySymbol = new LinkedHashMap<>();
        int taken = 0;
        for (SignalEntity s : day) {
            if (taken >= sample) {
                break;
            }
            if (!bySymbol.containsKey(s.getSymbol()) && bySymbol.size() >= maxSymbols) {
                continue;
            }
            bySymbol.computeIfAbsent(s.getSymbol(), k -> new ArrayList<>()).add(s);
            taken++;
        }
        ExchangeAdapter exchange = exchanges.getFirst();
        int checked = 0;
        int confirmed = 0;
        List<String> failures = new ArrayList<>();
        for (Map.Entry<String, List<SignalEntity>> e : bySymbol.entrySet()) {
            List<Candle> candles;
            try {
                candles = exchange.candles(e.getKey(), "1m", CANDLES);
            } catch (RuntimeException ex) {
                log.debug("Signal audit: no candles for {} ({})", e.getKey(), ex.toString());
                continue;
            }
            for (SignalEntity s : e.getValue()) {
                CandleCheck.Result r = CandleCheck.check(s.getType(), s.getPrice(), s.getValue(), s.getFiredAt().toEpochMilli(), candles);
                switch (r.verdict()) {
                    case CONFIRMED -> {
                        checked++;
                        confirmed++;
                    }
                    case FAILED -> {
                        checked++;
                        failures.add("%s %s %s: %s".formatted(s.getType(), s.getSymbol(), s.getFiredAt(), r.reason()));
                    }
                    case UNCHECKED -> {
                    }
                }
            }
        }
        Run run = new Run(taken, checked, confirmed, failures);
        audits.record(now, taken, checked, confirmed, String.join("\n", failures));
        report(run);
        return run;
    }

    private void report(Run run) {
        int failed = run.checked() - run.confirmed();
        String line = "Signal audit: %d of %d sampled signals checked against exchange candles, %d confirmed, %d not."
                .formatted(run.checked(), run.sampled(), run.confirmed(), failed);
        if (run.checked() >= minChecked && failed > run.checked() * alarmShare) {
            String text = "⚠ " + line + " Above " + Math.round(alarmShare * 100) + "%: the stream may be mixing prices again.\n\n"
                    + String.join("\n", run.failures().subList(0, Math.min(5, run.failures().size())));
            log.error("{}", text);
            events.publishEvent(new OwnerNotice(text));
        } else {
            log.info("{}", line);
        }
    }
}
