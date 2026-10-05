package dev.pulse.signal;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

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

    @Transactional(readOnly = true)
    public long countSince(Instant since) {
        return repository.countByFiredAtAfter(since);
    }
}
