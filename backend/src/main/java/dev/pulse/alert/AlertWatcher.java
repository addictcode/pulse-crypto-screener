package dev.pulse.alert;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import dev.pulse.market.MarketStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * Compares the waiting alerts with live prices. An alert fires once: it is marked in the
 * database first and announced after, so a crash in between cannot send it twice.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AlertWatcher {

    private final AlertService alerts;
    private final MarketStore market;
    private final ApplicationEventPublisher events;

    @Scheduled(fixedRate = 2_000, initialDelay = 5_000)
    void check() {
        List<AlertFired> fired = new ArrayList<>();
        for (PriceAlert alert : alerts.waiting()) {
            Double price = market.price(alert.symbol());
            if (price != null && alert.crossedAt(price)) {
                fired.add(new AlertFired(alert, price));
            }
        }
        if (fired.isEmpty()) {
            return;
        }
        alerts.markFired(fired.stream().map(f -> f.alert().id()).toList(), Instant.now());
        fired.forEach(events::publishEvent);
        log.info("Alerts: {} fired", fired.size());
    }
}
