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

    /** Busiest kinds first. */
    @Transactional(readOnly = true)
    public List<OutcomeStats> outcomes(Instant since) {
        return repository.outcomesSince(since).stream()
                .map(OutcomeRow::toStats)
                .sorted(Comparator.comparingLong(OutcomeStats::measured).reversed())
                .toList();
    }
}
