package dev.pulse.alert;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;

/**
 * Price alerts per user. The alerts still waiting are also kept in memory: the watcher looks at
 * them every couple of seconds and should not ask the database each time.
 */
@Service
@RequiredArgsConstructor
public class AlertService {

    public static final int MAX_PER_USER = 50;

    private final PriceAlertRepository repository;
    private volatile List<PriceAlert> waiting = List.of();

    @EventListener(ApplicationReadyEvent.class)
    @Transactional(readOnly = true)
    public void load() {
        refresh();
    }

    /** Every alert that has not fired yet, across all users. */
    public List<PriceAlert> waiting() {
        return waiting;
    }

    @Transactional(readOnly = true)
    public List<PriceAlert> waitingFor(long userId) {
        return repository.findByUserIdAndFiredAtIsNullOrderBySymbolAscLevelDesc(userId).stream()
                .map(PriceAlertEntity::toAlert)
                .toList();
    }

    /**
     * @param price the current price, which decides the side the alert fires from
     * @throws IllegalArgumentException with a message for the user when the alert makes no sense
     */
    @Transactional
    public PriceAlert create(long userId, String symbol, double level, double price) {
        if (level <= 0 || Double.isNaN(level) || Double.isInfinite(level)) {
            throw new IllegalArgumentException("The level has to be a positive price.");
        }
        if (level == price) {
            throw new IllegalArgumentException("That is the current price.");
        }
        if (repository.countByUserIdAndFiredAtIsNull(userId) >= MAX_PER_USER) {
            throw new IllegalArgumentException("That is the limit of " + MAX_PER_USER + " alerts. Remove one with /unalert first.");
        }
        boolean duplicate = repository.findByUserIdAndSymbolAndFiredAtIsNull(userId, symbol).stream()
                .anyMatch(a -> a.getLevel() == level);
        if (duplicate) {
            throw new IllegalArgumentException("There is already an alert at that price.");
        }
        PriceAlert created = repository.save(PriceAlertEntity.of(userId, symbol, level, level > price)).toAlert();
        refresh();
        return created;
    }

    /** @return false when the user has no waiting alert with this id */
    @Transactional
    public boolean remove(long userId, long id) {
        var found = repository.findByIdAndUserIdAndFiredAtIsNull(id, userId);
        found.ifPresent(repository::delete);
        refresh();
        return found.isPresent();
    }

    /** @return how many alerts were removed */
    @Transactional
    public int removeFor(long userId, String symbol) {
        List<PriceAlertEntity> found = repository.findByUserIdAndSymbolAndFiredAtIsNull(userId, symbol);
        repository.deleteAll(found);
        refresh();
        return found.size();
    }

    @Transactional
    public void markFired(Collection<Long> ids, Instant at) {
        repository.findAllById(ids).forEach(alert -> alert.fire(at));
        refresh();
    }

    private void refresh() {
        // inside the transaction: flush first so the query sees what was just changed
        repository.flush();
        waiting = repository.findByFiredAtIsNull().stream().map(PriceAlertEntity::toAlert).toList();
    }
}
