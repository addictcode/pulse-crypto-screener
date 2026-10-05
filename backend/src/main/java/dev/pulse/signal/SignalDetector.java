package dev.pulse.signal;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;
import dev.pulse.depth.DensityScanner;
import dev.pulse.depth.Wall;
import dev.pulse.market.MarketStore;
import dev.pulse.market.SymbolMetrics;
import lombok.extern.slf4j.Slf4j;

/**
 * Runs the rules over the whole market every couple of seconds, stores what fires and announces
 * it. During a market-wide move dozens of symbols trigger at once, so each scan keeps only the
 * strongest few; the rest are not lost, they fire on the next scans as their cooldowns allow.
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "pulse.signals", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SignalDetector {

    static final int MAX_PER_SCAN = 12;

    private final MarketStore market;
    private final DensityScanner density;
    private final SignalHistory history;
    private final ApplicationEventPublisher events;
    private final PulseProperties.Signals config;
    private final Cooldowns cooldowns;

    private long firstDataAt;
    private boolean baselineTaken;

    public SignalDetector(MarketStore market, DensityScanner density, SignalHistory history,
                          ApplicationEventPublisher events, PulseProperties properties) {
        this.market = market;
        this.density = density;
        this.history = history;
        this.events = events;
        this.config = properties.signals();
        this.cooldowns = new Cooldowns(config.escalation());
    }

    /** Cooldowns survive restarts: replay everything that could still be cooling down. */
    @EventListener(ApplicationReadyEvent.class)
    synchronized void restoreCooldowns() {
        Duration longest = Arrays.stream(SignalType.values()).map(SignalType::cooldown).max(Duration::compareTo).orElseThrow();
        Duration window = longest.compareTo(Cooldowns.BUDGET_WINDOW) > 0 ? longest : Cooldowns.BUDGET_WINDOW;
        List<Signal> recent = history.since(Instant.now().minus(window));
        cooldowns.restore(recent);
        log.info("Signals: cooldowns restored from {} recent signals", recent.size());
    }

    @Scheduled(fixedRateString = "${pulse.signals.scan-interval-ms}")
    synchronized void scan() {
        long now = System.currentTimeMillis();
        List<SymbolMetrics> rows = market.snapshot(now);
        if (rows.isEmpty()) {
            return;
        }
        if (firstDataAt == 0) {
            firstDataAt = now;
        }
        if (now - firstDataAt < config.warmup().toMillis()) {
            return;
        }

        Map<String, Wall> nearestWalls = new HashMap<>();
        for (Wall wall : density.latest().walls()) {
            nearestWalls.putIfAbsent(wall.symbol(), wall); // walls arrive nearest first
        }

        List<Signal> candidates = new ArrayList<>();
        for (SymbolMetrics m : rows) {
            double[] liquidated = market.liquidationsBySide(m.symbol());
            candidates.addAll(SignalRules.evaluate(m, liquidated[0], liquidated[1], nearestWalls.get(m.symbol()),
                    config.minVolume24h(), now));
        }
        candidates.sort(Comparator.comparingDouble(SignalDetector::strength).reversed());

        if (!baselineTaken) {
            // conditions already true at startup become the baseline instead of a burst of alerts
            baselineTaken = true;
            List<Signal> standing = candidates.stream().filter(c -> c.type().isState()).toList();
            standing.forEach(cooldowns::remember);
            candidates.removeAll(standing);
            log.info("Signals: {} standing conditions taken as the baseline", standing.size());
        }

        int fired = 0;
        for (Signal candidate : candidates) {
            if (fired >= MAX_PER_SCAN) {
                break;
            }
            if (cooldowns.admit(candidate)) {
                Signal stored = history.record(candidate);
                events.publishEvent(new SignalFired(stored));
                fired++;
            }
        }
        if (fired > 0) {
            log.debug("Signals: {} fired out of {} candidates", fired, candidates.size());
        }
    }

    /** How far past its floor a candidate is, comparable across types. */
    static double strength(Signal s) {
        SignalType type = s.type();
        return type.higherIsStronger() ? s.value() / type.floor() : type.floor() / Math.max(s.value(), 1e-9);
    }
}
