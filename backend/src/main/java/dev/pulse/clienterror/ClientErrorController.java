package dev.pulse.clienterror;

import java.time.Clock;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.config.ClientAddress;
import jakarta.servlet.http.HttpServletRequest;

/**
 * {@code POST /api/client-errors}: a page caught an error it did not handle (web/src/client-errors.ts).
 * Nobody reads the answer: 204 whether the report was kept, sampled out or switched off
 * ({@code PULSE_CLIENT_ERRORS_ENABLED=false}), so a visitor's console never shows a second error
 * about the first.
 */
@RestController
public class ClientErrorController {

    /** What the page sends. Anything else in the body is ignored. */
    public record Report(String message, String stack, String page, String build, String lang) {
    }

    private final ClientErrorLog log;
    private final boolean enabled;
    private final Clock clock;
    private final ClientErrorGate gate;

    @Autowired
    public ClientErrorController(ClientErrorLog log, @Value("${pulse.client-errors.enabled:true}") boolean enabled) {
        this(log, enabled, Clock.systemUTC(), new ClientErrorGate());
    }

    ClientErrorController(ClientErrorLog log, boolean enabled, Clock clock, ClientErrorGate gate) {
        this.log = log;
        this.enabled = enabled;
        this.clock = clock;
        this.gate = gate;
    }

    @PostMapping("/api/client-errors")
    public ResponseEntity<Void> report(@RequestBody(required = false) Report report, HttpServletRequest request) {
        if (enabled && report != null && report.message() != null && gate.admit(ClientAddress.of(request), clock.millis())) {
            log.count(ClientError.of(report.message(), report.stack(), report.page(), report.build(), report.lang()), clock.instant());
        }
        return ResponseEntity.noContent().build();
    }
}
