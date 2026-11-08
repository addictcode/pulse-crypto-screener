package dev.pulse.push;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalType;

/**
 * The subscriptions: who asked for what. A subscription is a push endpoint and two keys from the
 * browser; it carries no address and no account, and is found again only by its endpoint.
 */
@Service
public class PushService {

    /** What a page sends: the browser's subscription (PushSubscription.toJSON()) and its choices. */
    public record Request(String endpoint, Keys keys, List<String> symbols, Boolean strongOnly, String lang) {
    }

    public record Keys(String p256dh, String auth) {
    }

    private final PushSubscriptionRepository repository;
    private final PushProperties properties;

    PushService(PushSubscriptionRepository repository, PushProperties properties) {
        this.repository = repository;
        this.properties = properties;
    }

    public boolean enabled() {
        return properties.enabled();
    }

    /**
     * Adds or updates a subscription. Refuses an endpoint that is not https on a known push service:
     * the server will POST to whatever is stored here, and that must never be an address of the
     * visitor's choosing.
     */
    @Transactional
    public void subscribe(Request request, Instant now) {
        String endpoint = checkedEndpoint(request.endpoint());
        if (request.keys() == null) {
            throw new IllegalArgumentException("no keys");
        }
        byte[] key = WebPushCrypto.unb64(nonNull(request.keys().p256dh()));
        byte[] auth = WebPushCrypto.unb64(nonNull(request.keys().auth()));
        if (key.length != 65 || key[0] != 4 || auth.length != 16) {
            throw new IllegalArgumentException("bad keys");
        }
        Set<String> symbols = new TreeSet<>();
        if (request.symbols() != null) {
            for (String s : request.symbols()) {
                String symbol = nonNull(s).toUpperCase(Locale.ROOT);
                if (symbol.matches("[A-Z0-9]{2,20}USDT")) {
                    symbols.add(symbol);
                }
            }
        }
        if (symbols.size() > properties.maxSymbols()) {
            throw new IllegalArgumentException("too many pairs");
        }
        PushSubscription subscription = repository.findByEndpoint(endpoint).orElseGet(() -> new PushSubscription(endpoint, now));
        subscription.setP256dh(WebPushCrypto.b64(key));
        subscription.setAuth(WebPushCrypto.b64(auth));
        subscription.setSymbols(String.join(",", symbols));
        subscription.setStrongOnly(request.strongOnly() == null || request.strongOnly());
        subscription.setLang("ru".equals(request.lang()) ? "ru" : "en");
        repository.save(subscription);
    }

    @Transactional
    public void unsubscribe(String endpoint) {
        repository.deleteByEndpoint(nonNull(endpoint));
    }

    String checkedEndpoint(String raw) {
        URI uri;
        try {
            uri = URI.create(nonNull(raw).trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("bad endpoint");
        }
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        boolean secure = "https".equals(uri.getScheme()) || properties.allowHttp() && "http".equals(uri.getScheme());
        boolean known = properties.allowedHosts().stream().anyMatch(h -> host.equals(h) || host.endsWith("." + h));
        if (!secure || !known || raw.length() > 1024) {
            throw new IllegalArgumentException("not a known push service");
        }
        return uri.toString();
    }

    /** Whether a subscription asked for this signal: its pairs (or all), and strong ones only if it said so. */
    static boolean wants(Set<String> symbols, boolean strongOnly, Signal signal, double strength) {
        if (!symbols.isEmpty() && !symbols.contains(signal.symbol())) {
            return false;
        }
        return !strongOnly || strong(signal.type(), signal.value(), strength);
    }

    /** The same test as the public channel: this many times past the system floor. */
    static boolean strong(SignalType type, double value, double strength) {
        double threshold = type.higherIsStronger() ? type.floor() * strength : type.floor() / strength;
        return type.meets(value, threshold);
    }

    private static String nonNull(String s) {
        if (s == null || s.isBlank()) {
            throw new IllegalArgumentException("missing field");
        }
        return s;
    }
}
