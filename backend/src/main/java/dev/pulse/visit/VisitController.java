package dev.pulse.visit;

import java.time.Clock;
import java.time.LocalDate;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.config.ClientAddress;
import jakarta.servlet.http.HttpServletRequest;

/**
 * {@code POST /api/hit}: a page tells the server it was opened, or that a Telegram button was
 * clicked. Sent with {@code navigator.sendBeacon}, so nobody reads the answer; it is 204 whether
 * or not the hit was counted, and 400 only for a page that is not on the list.
 */
@RestController
public class VisitController {

    /** @param page one of the {@link FunnelStep} keys a page may send; source is free text, folded by {@link VisitSource#of} */
    public record Hit(String page, String source) {
    }

    private final VisitLog visits;
    private final Clock clock;
    private final HitGate gate = new HitGate();

    /** Days are UTC days, like every other time Pulse stores. */
    @Autowired
    public VisitController(VisitLog visits) {
        this(visits, Clock.systemUTC());
    }

    VisitController(VisitLog visits, Clock clock) {
        this.visits = visits;
        this.clock = clock;
    }

    @PostMapping("/api/hit")
    public ResponseEntity<Void> hit(@RequestBody Hit hit, HttpServletRequest request) {
        FunnelStep step = hit == null ? null : FunnelStep.fromKey(hit.page()).filter(FunnelStep::fromPage).orElse(null);
        if (step == null) {
            return ResponseEntity.badRequest().build();
        }
        if (gate.admit(ClientAddress.of(request), step, clock.millis())) {
            visits.count(LocalDate.now(clock), step, VisitSource.of(hit.source()));
        }
        return ResponseEntity.noContent().build();
    }
}
