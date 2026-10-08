package dev.pulse.signal;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.market.MarketStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Checks back on every signal 5 minutes, 15 minutes and an hour later and stores what the price
 * did. That turns the feed from "something happened" into "and this is what usually follows".
 * <p>
 * The price is read from the live market the moment a horizon passes. A signal whose horizon
 * passed while the backend was down is left unmeasured rather than given a wrong number.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "pulse.signals", name = "enabled", havingValue = "true", matchIfMissing = true)
public class OutcomeTracker {

    /** How late a measurement may be and still count as "at the horizon". */
    static final Duration GRACE = Duration.ofMinutes(2);

    private final SignalHistory history;
    private final MarketStore market;
    private final ApplicationEventPublisher events;

    @Scheduled(fixedRate = 20_000, initialDelay = 20_000)
    void measure() {
        measure(Instant.now());
    }

    void measure(Instant now) {
        for (Horizon horizon : Horizon.values()) {
            Instant due = now.minus(horizon.delay());
            List<Signal> waiting = history.unmeasured(horizon, due.minus(GRACE), due);
            Map<Long, Double> changes = new HashMap<>();
            for (Signal signal : waiting) {
                Double change = changePct(signal.price(), market.price(signal.symbol()));
                if (change != null) {
                    changes.put(signal.id(), change);
                }
            }
            if (!changes.isEmpty()) {
                events.publishEvent(new SignalsMeasured(history.recordOutcomes(horizon, changes)));
                log.debug("Outcomes: {} signals measured at {}", changes.size(), horizon.label());
            }
        }
    }

    /** Percent change rounded to 0.01, or null when either price is missing. */
    static Double changePct(double then, Double now) {
        if (now == null || now <= 0 || then <= 0) {
            return null;
        }
        return Math.round((now / then - 1) * 10_000) / 100.0;
    }
}
