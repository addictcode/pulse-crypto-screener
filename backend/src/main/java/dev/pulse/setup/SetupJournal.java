package dev.pulse.setup;

import java.time.Instant;
import java.util.List;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;

/**
 * Every setup the scanner has taken, from the moment it opened to how it ended. This is the
 * forward test of the strategy: unlike a backtest, nothing here was known in advance. The open
 * trades are also kept in memory, because the tracker looks at them every couple of seconds.
 */
@Service
@RequiredArgsConstructor
public class SetupJournal {

    private final SetupRepository repository;
    private volatile List<SetupTrade> open = List.of();

    @EventListener(ApplicationReadyEvent.class)
    @Transactional(readOnly = true)
    public void load() {
        refresh();
    }

    public List<SetupTrade> open() {
        return open;
    }

    /** One position at a time per pair and timeframe, as in the backtest. */
    public boolean holds(String symbol, String timeframe) {
        return open.stream().anyMatch(t -> t.symbol().equals(symbol) && t.timeframe().equals(timeframe));
    }

    @Transactional
    public SetupTrade open(String symbol, String timeframe, SetupPlan plan, Instant at, Instant expiresAt) {
        SetupTrade trade = repository.save(SetupEntity.open(symbol, timeframe, plan, at, expiresAt)).toTrade();
        refresh();
        return trade;
    }

    /** @return the finished trade, or null when it was already closed */
    @Transactional
    public SetupTrade close(long id, SetupStatus outcome, double exit, double resultR, Instant at) {
        SetupEntity trade = repository.findById(id).orElse(null);
        if (trade == null || trade.getStatus() != SetupStatus.OPEN) {
            return null;
        }
        trade.close(outcome, exit, resultR, at);
        refresh();
        return trade.toTrade();
    }

    @Transactional(readOnly = true)
    public List<SetupTrade> closed(int limit) {
        return repository.findByStatusNotOrderByClosedAtDesc(SetupStatus.OPEN, PageRequest.of(0, limit)).stream()
                .map(SetupEntity::toTrade)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<SetupStats> stats(Instant since) {
        return repository.statsSince(since);
    }

    /** When the journal began, or null while it is empty. */
    @Transactional(readOnly = true)
    public Instant since() {
        return repository.firstOpenedAt();
    }

    private void refresh() {
        open = repository.findByStatusOrderByOpenedAtDesc(SetupStatus.OPEN).stream().map(SetupEntity::toTrade).toList();
    }
}
