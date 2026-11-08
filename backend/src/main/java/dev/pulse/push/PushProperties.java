package dev.pulse.push;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Web push. On only when both VAPID keys are set: without them the site hides notifications.
 *
 * @param vapidPublicKey  the server's key, base64url of the uncompressed P-256 point (65 bytes)
 * @param vapidPrivateKey its private half, base64url of 32 bytes
 * @param allowedHosts    push services a subscription may name; a host matches itself and its subdomains
 * @param allowHttp       plain http endpoints, for tests against a local fake push service only
 */
@ConfigurationProperties("pulse.push")
public record PushProperties(String vapidPublicKey, String vapidPrivateKey, String subject, int perHour, int perSecond, double strength,
                             List<String> allowedHosts, int maxSymbols, boolean allowHttp) {

    public PushProperties {
        allowedHosts = allowedHosts == null ? List.of() : List.copyOf(allowedHosts);
        perHour = perHour <= 0 ? 4 : perHour;
        perSecond = perSecond <= 0 ? 20 : perSecond;
        strength = strength <= 0 ? 2 : strength;
        maxSymbols = maxSymbols <= 0 ? 50 : maxSymbols;
    }

    public boolean enabled() {
        return vapidPublicKey != null && !vapidPublicKey.isBlank() && vapidPrivateKey != null && !vapidPrivateKey.isBlank();
    }
}
