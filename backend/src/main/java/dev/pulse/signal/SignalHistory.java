package dev.pulse.signal;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;

/**
 * Stores signals and keeps the most recent ones in memory, so a browser connecting or the bot
 * asking for "/last" never waits on the database.
 */
@Service
@RequiredArgsConstructor
public class SignalHistory {

    static final int CACHED = 100;

    private final SignalRepository repository;
    private final SignalRollup rollup;
    private final Deque<Signal> recent = new ArrayDeque<>();

    @EventListener(ApplicationReadyEvent.class)
    @Transactional(readOnly = true)
    public void warmCache() {
        List<Signal> stored = repository.findByOrderByFiredAtDesc(PageRequest.of(0, CACHED)).stream()
                .map(SignalEntity::toSignal)
                .toList();
        synchronized (recent) {
            recent.clear();
            recent.addAll(stored);
        }
    }

    @Transactional
    public Signal record(Signal signal) {
        Signal stored = repository.save(SignalEntity.from(signal)).toSignal();
        synchronized (recent) {
            recent.addFirst(stored);
            while (recent.size() > CACHED) {
                recent.pollLast();
            }
        }
        return stored;
    }

    /** Newest first. */
    public List<Signal> recent(int limit) {
        synchronized (recent) {
            return recent.stream().limit(limit).toList();
        }
    }

    @Transactional(readOnly = true)
    public List<Signal> recentFor(String symbol, int limit) {
        return repository.findBySymbolOrderByFiredAtDesc(symbol, PageRequest.of(0, limit)).stream()
                .map(SignalEntity::toSignal)
                .toList();
    }

    /** Oldest first, for replaying state such as cooldowns. */
    @Transactional(readOnly = true)
    public List<Signal> since(Instant since) {
        return repository.findByFiredAtAfterOrderByFiredAtAsc(since).stream().map(SignalEntity::toSignal).toList();
    }

    @Transactional(readOnly = true)
    public long countSince(Instant since) {
        return repository.countByFiredAtAfter(since);
    }

    /** Signals fired inside the window that have no outcome for this horizon yet. */
    @Transactional(readOnly = true)
    public List<Signal> unmeasured(Horizon horizon, Instant from, Instant to) {
        List<SignalEntity> found = switch (horizon) {
            case M5 -> repository.findByFiredAtBetweenAndRet5mIsNull(from, to);
            case M15 -> repository.findByFiredAtBetweenAndRet15mIsNull(from, to);
            case H1 -> repository.findByFiredAtBetweenAndRet1hIsNull(from, to);
        };
        return found.stream().map(SignalEntity::toSignal).toList();
    }

    /**
     * @param changes price change in percent by signal id
     * @return the updated signals
     */
    @Transactional
    public List<Signal> recordOutcomes(Horizon horizon, Map<Long, Double> changes) {
        List<Signal> updated = new ArrayList<>();
        // loaded entities are managed: changing them is enough, Hibernate writes the UPDATEs on commit
        for (SignalEntity entity : repository.findAllById(changes.keySet())) {
            entity.setOutcome(horizon, changes.get(entity.getId()));
            updated.add(entity.toSignal());
        }
        synchronized (recent) {
            Map<Long, Signal> byId = new HashMap<>();
            updated.forEach(s -> byId.put(s.id(), s));
            List<Signal> refreshed = recent.stream().map(s -> byId.getOrDefault(s.id(), s)).toList();
            recent.clear();
            recent.addAll(refreshed);
        }
        return updated;
    }

    /** How long an answer of {@link #outcomes} is served again: the numbers move by the hour, visitors come by the thousand. */
    static final long OUTCOMES_TTL_MS = 60_000;

    private record Cached(long at, List<OutcomeStats> stats) {
    }

    private final Map<Long, Cached> outcomeCache = new java.util.concurrent.ConcurrentHashMap<>();

    /**
     * Busiest kinds first. Whole days come from the daily rollup and only the edges of the period
     * from the signals themselves; one answer per period length is kept for a minute.
     */
    @Transactional(readOnly = true)
    public List<OutcomeStats> outcomes(Instant since) {
        long now = System.currentTimeMillis();
        // the period's length, to the minute: "the last 7 days" asked twice in a minute is one question
        long key = (now - since.toEpochMilli()) / 60_000;
        Cached cached = outcomeCache.get(key);
        if (cached != null && now - cached.at() < OUTCOMES_TTL_MS) {
            return cached.stats();
        }
        List<OutcomeStats> stats = rows(since, Instant.ofEpochMilli(now)).stream()
                .map(OutcomeRow::toStats)
                .sorted(Comparator.comparingLong(OutcomeStats::measured).reversed())
                .toList();
        outcomeCache.put(key, new Cached(now, stats));
        return stats;
    }

    /** Outcome sums for signals fired in [since, now): rolled-up days in the middle, raw rows at the edges. */
    List<OutcomeRow> rows(Instant since, Instant now) {
        java.time.LocalDate first = since.atZone(java.time.ZoneOffset.UTC).toLocalDate().plusDays(1);
        java.time.LocalDate last = now.atZone(java.time.ZoneOffset.UTC).toLocalDate().minusDays(1);
        if (rollup == null || last.isBefore(first) || !rollup.covers(first, last)) {
            return repository.outcomesSince(since);
        }
        Map<String, SignalRollup.Day> sums = new HashMap<>(rollup.sum(first, last));
        List<OutcomeRow> edges = new ArrayList<>(repository.outcomesBetween(since, SignalRollup.start(first)));
        edges.addAll(repository.outcomesBetween(SignalRollup.start(last.plusDays(1)), now.plusMillis(1)));
        for (OutcomeRow r : edges) {
            SignalRollup.Day add = new SignalRollup.Day(r.type(), r.direction(),
                    r.n5m(), r.n5m() == 0 ? 0 : r.avg5m() * r.n5m(), r.up5m() == null ? 0 : r.up5m(),
                    r.n15m(), r.n15m() == 0 ? 0 : r.avg15m() * r.n15m(), r.up15m() == null ? 0 : r.up15m(),
                    r.n1h(), r.n1h() == 0 ? 0 : r.avg1h() * r.n1h(), r.up1h() == null ? 0 : r.up1h());
            sums.merge(r.type() + "/" + r.direction(), add, (a, b) -> new SignalRollup.Day(a.type(), a.direction(),
                    a.n5() + b.n5(), a.s5() + b.s5(), a.u5() + b.u5(), a.n15() + b.n15(), a.s15() + b.s15(), a.u15() + b.u15(),
                    a.n60() + b.n60(), a.s60() + b.s60(), a.u60() + b.u60()));
        }
        return sums.values().stream()
                .map(d -> new OutcomeRow(d.type(), d.direction(),
                        d.n5(), d.n5() == 0 ? null : d.s5() / d.n5(), d.u5(),
                        d.n15(), d.n15() == 0 ? null : d.s15() / d.n15(), d.u15(),
                        d.n60(), d.n60() == 0 ? null : d.s60() / d.n60(), d.u60()))
                .toList();
    }
}
