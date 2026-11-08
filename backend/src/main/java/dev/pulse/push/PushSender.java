package dev.pulse.push;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalFired;
import dev.pulse.signal.SignalTextRu;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * Sends notifications. A fired signal is matched against every subscription; each match waits in
 * a bounded queue, and one worker posts them to the push services at a steady pace. A browser gets
 * at most {@code per-hour} notifications an hour; a push service answering 404 or 410 means the
 * subscription is gone, and it is deleted.
 */
@Slf4j
@Component
class PushSender {

    record Job(String endpoint, String p256dh, String auth, String payload) {
    }

    private static final int QUEUE = 10_000;
    private static final long HOUR_MS = 3_600_000;

    private final PushSubscriptionRepository repository;
    private final PushProperties properties;
    private final BlockingQueue<Job> queue = new ArrayBlockingQueue<>(QUEUE);
    private final Map<String, Deque<Long>> sent = new ConcurrentHashMap<>();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private volatile boolean running;

    PushSender(PushSubscriptionRepository repository, PushProperties properties) {
        this.repository = repository;
        this.properties = properties;
    }

    @EventListener(ApplicationReadyEvent.class)
    void start() {
        if (!properties.enabled()) {
            return;
        }
        running = true;
        Thread.ofVirtual().name("push-sender").start(this::work);
        log.info("Web push: on, at most {} a browser an hour", properties.perHour());
    }

    @EventListener
    void onSignal(SignalFired event) {
        if (!running) {
            return;
        }
        Signal signal = event.signal();
        long now = System.currentTimeMillis();
        for (PushSubscription s : repository.findAll()) {
            if (PushService.wants(s.symbolSet(), s.isStrongOnly(), signal, properties.strength()) && admit(s.getEndpoint(), now)
                    && !queue.offer(new Job(s.getEndpoint(), s.getP256dh(), s.getAuth(), payload(signal, s.getLang())))) {
                log.warn("Web push: queue full, a notification dropped");
            }
        }
    }

    /** At most per-hour notifications to one browser in any hour. */
    boolean admit(String endpoint, long now) {
        Deque<Long> times = sent.computeIfAbsent(endpoint, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && now - times.peekFirst() >= HOUR_MS) {
                times.pollFirst();
            }
            if (times.size() >= properties.perHour()) {
                return false;
            }
            times.addLast(now);
            return true;
        }
    }

    /** What the service worker shows: a title, a line, the pair's chart to open. */
    static String payload(Signal s, String lang) {
        String title = "ru".equals(lang) ? SignalTextRu.title(s) : s.title();
        String body = "ru".equals(lang) ? "Pulse видит это сейчас. Не финансовый совет." : "Pulse sees it now. Not financial advice.";
        return "{\"title\":" + json(title) + ",\"body\":" + json(body) + ",\"tag\":" + json(s.symbol()) + ",\"url\":" + json("/app/#screener:" + s.symbol()) + "}";
    }

    private static String json(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private void work() {
        long gap = 1000L / properties.perSecond();
        while (running) {
            try {
                Job job = queue.poll(1, TimeUnit.SECONDS);
                if (job != null) {
                    send(job);
                    Thread.sleep(gap);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (RuntimeException e) {
                log.warn("Web push: send failed: {}", e.getMessage());
            }
        }
    }

    void send(Job job) throws InterruptedException {
        URI endpoint = URI.create(job.endpoint());
        byte[] body = WebPushCrypto.encrypt(job.payload().getBytes(StandardCharsets.UTF_8), WebPushCrypto.unb64(job.p256dh()), WebPushCrypto.unb64(job.auth()));
        String audience = endpoint.getScheme() + "://" + endpoint.getRawAuthority();
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofSeconds(15))
                .header("Content-Encoding", "aes128gcm")
                .header("Content-Type", "application/octet-stream")
                // a signal is news for a short while: no use delivering it tomorrow
                .header("TTL", "1800")
                .header("Urgency", "normal")
                .header("Authorization", WebPushCrypto.vapidHeader(audience, properties.subject(), Instant.now().getEpochSecond(),
                        WebPushCrypto.unb64(properties.vapidPublicKey()), WebPushCrypto.unb64(properties.vapidPrivateKey())))
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();
        try {
            int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            if (status == 404 || status == 410) {
                repository.deleteByEndpoint(job.endpoint());
                sent.remove(job.endpoint());
            } else if (status == 429) {
                // the push service asks for a pause; this one is dropped rather than retried late
                Thread.sleep(5_000);
            } else if (status >= 400) {
                log.warn("Web push: {} answered {}", endpoint.getHost(), status);
            }
        } catch (java.io.IOException e) {
            log.warn("Web push: {} unreachable: {}", endpoint.getHost(), e.getMessage());
        }
    }

    /** For tests: the queue's length. */
    List<Job> pending() {
        return List.copyOf(queue);
    }

    @PreDestroy
    void stop() {
        running = false;
    }
}
