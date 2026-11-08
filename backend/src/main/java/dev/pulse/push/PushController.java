package dev.pulse.push;

import java.time.Instant;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import dev.pulse.config.ClientAddress;
import jakarta.servlet.http.HttpServletRequest;

/**
 * {@code /api/push/*}: the key a browser needs to subscribe, subscribing and unsubscribing. While
 * no VAPID keys are set every call answers 404, and the site does not offer notifications.
 */
@RestController
class PushController {

    private final PushService push;
    private final PushProperties properties;
    private final SubscribeGate gate = new SubscribeGate();

    PushController(PushService push, PushProperties properties) {
        this.push = push;
        this.properties = properties;
    }

    @GetMapping("/api/push/key")
    ResponseEntity<Map<String, String>> key() {
        return push.enabled() ? ResponseEntity.ok(Map.of("key", properties.vapidPublicKey())) : ResponseEntity.notFound().build();
    }

    @PostMapping("/api/push/subscribe")
    ResponseEntity<Void> subscribe(@RequestBody PushService.Request request, HttpServletRequest http) {
        if (!push.enabled()) {
            return ResponseEntity.notFound().build();
        }
        if (!gate.admit(ClientAddress.of(http), System.currentTimeMillis())) {
            return ResponseEntity.status(429).build();
        }
        try {
            push.subscribe(request, Instant.now());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.noContent().build();
    }

    public record Unsubscribe(String endpoint) {
    }

    @PostMapping("/api/push/unsubscribe")
    ResponseEntity<Void> unsubscribe(@RequestBody Unsubscribe request) {
        if (!push.enabled()) {
            return ResponseEntity.notFound().build();
        }
        try {
            push.unsubscribe(request.endpoint());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.noContent().build();
    }
}
