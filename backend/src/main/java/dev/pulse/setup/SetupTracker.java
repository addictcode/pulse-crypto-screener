package dev.pulse.setup;

import java.time.Instant;
import java.util.Optional;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.market.MarketStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Follows every open setup against live prices until it ends: at the stop, at the target, or at
 * market when its time runs out. The stop is looked at first, so a price that somehow shows both
 * counts as a loss, the same pessimistic order the backtest uses.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "pulse.setups", name = "enabled", havingValue = "true")
public class SetupTracker {

    private final SetupJournal journal;
    private final MarketStore market;
    private final ApplicationEventPublisher events;

    /** How one open trade ends at this price and moment, if it does. */
    record Ending(SetupStatus status, double exit) {
    }

    @Scheduled(fixedRate = 2_000, initialDelay = 10_000)
    void follow() {
        follow(Instant.now());
    }

    void follow(Instant now) {
        for (SetupTrade trade : journal.open()) {
            Double price = market.price(trade.symbol());
            if (price == null) {
                continue;
            }
            ending(trade, price, now).ifPresent(end -> {
                SetupTrade closed = journal.close(trade.id(), end.status(), end.exit(), SetupRules.resultR(trade.plan(), end.exit()), now);
                if (closed != null) {
                    events.publishEvent(new SetupClosed(closed));
                    log.info("Setups: {} {} {} at {}, {}R", closed.symbol(), closed.timeframe(), closed.status(), end.exit(), String.format("%.2f", closed.resultR()));
                }
            });
        }
    }

    /** Stop and target fill at their own price, a timed-out trade at whatever the market gives. */
    static Optional<Ending> ending(SetupTrade trade, double price, Instant now) {
        boolean isLong = trade.direction() == 1;
        if (isLong ? price <= trade.stop() : price >= trade.stop()) {
            return Optional.of(new Ending(SetupStatus.LOST, trade.stop()));
        }
        if (isLong ? price >= trade.target() : price <= trade.target()) {
            return Optional.of(new Ending(SetupStatus.WON, trade.target()));
        }
        if (!now.isBefore(trade.expiresAt())) {
            return Optional.of(new Ending(SetupStatus.TIMEOUT, price));
        }
        return Optional.empty();
    }
}
