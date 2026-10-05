package dev.pulse.signal;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.config.PulseProperties;
import dev.pulse.market.MarketStore;
import dev.pulse.market.SymbolMetrics;

/**
 * The live tape: every couple of seconds, everything that moves past the loose thresholds,
 * at most once per symbol and kind every few minutes unless it grows by half again.
 * Kept in memory only; a reconnecting browser gets the recent part of it.
 */
@Component
@ConditionalOnProperty(prefix = "pulse.signals", name = "enabled", havingValue = "true", matchIfMissing = true)
public class TapeDetector {

    static final Duration COOLDOWN = Duration.ofMinutes(3);
    static final double ESCALATION = 1.5;
    static final int KEEP = 150;

    private record Last(long time, double value) {
    }

    private final MarketStore market;
    private final ApplicationEventPublisher events;
    private final PulseProperties.Signals config;
    private final Map<String, Last> last = new HashMap<>();
    private final Deque<TapeItem> recent = new ArrayDeque<>();
    private long firstDataAt;

    public TapeDetector(MarketStore market, ApplicationEventPublisher events, PulseProperties properties) {
        this.market = market;
        this.events = events;
        this.config = properties.signals();
    }

    /** Newest first. */
    public List<TapeItem> recent(int limit) {
        synchronized (recent) {
            return recent.stream().limit(limit).toList();
        }
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
        // shorter settle time than the curated signals: the tape is meant to come alive quickly
        if (now - firstDataAt < config.warmup().toMillis() / 2) {
            return;
        }
        List<TapeItem> fresh = new ArrayList<>();
        for (SymbolMetrics m : rows) {
            double[] liquidated = market.liquidationsBySide(m.symbol());
            for (TapeItem item : TapeRules.evaluate(m, liquidated[0], liquidated[1], config.minVolume24h(), now)) {
                if (admit(item)) {
                    fresh.add(item);
                }
            }
        }
        if (fresh.isEmpty()) {
            return;
        }
        synchronized (recent) {
            fresh.forEach(recent::addFirst);
            while (recent.size() > KEEP) {
                recent.pollLast();
            }
        }
        events.publishEvent(new TapeFired(List.copyOf(fresh)));
    }

    private boolean admit(TapeItem item) {
        String key = item.symbol() + ":" + item.kind();
        Last previous = last.get(key);
        boolean fire = previous == null
                || item.time() - previous.time() >= COOLDOWN.toMillis()
                || Math.abs(item.value()) >= Math.abs(previous.value()) * ESCALATION;
        if (fire) {
            last.put(key, new Last(item.time(), item.value()));
        }
        return fire;
    }
}
