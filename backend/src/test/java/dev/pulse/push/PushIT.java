package dev.pulse.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.sun.net.httpserver.HttpServer;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalFired;
import dev.pulse.signal.SignalType;

/**
 * Web push end to end against a fake push service: subscribing, a signal encrypted for the browser
 * and signed with VAPID, and a subscription the push service no longer knows being deleted.
 */
@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false", "pulse.push.allow-http=true",
        "pulse.push.allowed-hosts=127.0.0.1", "pulse.push.per-second=100"})
@Import(TestcontainersConfiguration.class)
class PushIT {

    // a browser's keys (RFC 8291, appendix A) and a server key pair made for this test
    private static final String UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private static final String UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    private static final String AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
    private static final byte[][] VAPID = WebPushCrypto.newVapidKeys();

    private static HttpServer service;
    private static final List<Map<String, Object>> received = new CopyOnWriteArrayList<>();

    @Autowired
    private PushController controller;
    @Autowired
    private PushSubscriptionRepository repository;
    @Autowired
    private ApplicationEventPublisher events;

    @BeforeAll
    static void startPushService() throws IOException {
        service = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        service.createContext("/push/", exchange -> {
            received.add(Map.of("path", exchange.getRequestURI().getPath(),
                    "encoding", String.valueOf(exchange.getRequestHeaders().getFirst("Content-Encoding")),
                    "authorization", String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")),
                    "body", exchange.getRequestBody().readAllBytes()));
            int status = exchange.getRequestURI().getPath().endsWith("/gone") ? 410 : 201;
            exchange.sendResponseHeaders(status, -1);
            try (OutputStream out = exchange.getResponseBody()) {
                out.flush();
            }
        });
        service.start();
    }

    @AfterAll
    static void stopPushService() {
        service.stop(0);
    }

    @DynamicPropertySource
    static void keys(DynamicPropertyRegistry registry) {
        registry.add("pulse.push.vapid-public-key", () -> WebPushCrypto.b64(VAPID[0]));
        registry.add("pulse.push.vapid-private-key", () -> WebPushCrypto.b64(VAPID[1]));
    }

    private String endpoint(String name) {
        return "http://127.0.0.1:" + service.getAddress().getPort() + "/push/" + name;
    }

    private void subscribe(String name, List<String> symbols, boolean strongOnly, String lang) {
        var answer = controller.subscribe(new PushService.Request(endpoint(name), new PushService.Keys(UA_PUBLIC, AUTH), symbols, strongOnly, lang),
                new MockHttpServletRequest());
        assertThat(answer.getStatusCode().value()).isEqualTo(204);
    }

    private void fire(String symbol, double value) {
        events.publishEvent(new SignalFired(new Signal(System.nanoTime(), SignalType.PUMP, symbol, System.currentTimeMillis(), 1, value,
                symbol.replace("USDT", "") + " jumps " + value + "% in five minutes", "", 1, null, null, null)));
    }

    @Test
    void aSignalReachesTheBrowserEncryptedAndSigned() throws Exception {
        assertThat(controller.key().getBody()).containsEntry("key", WebPushCrypto.b64(VAPID[0]));
        subscribe("watch", List.of("pushusdt"), false, "ru");

        fire("OTHERUSDT", 3);
        fire("PUSHUSDT", 2.5);

        assertThat(await(() -> received.stream().anyMatch(r -> r.get("path").equals("/push/watch")))).isTrue();
        Map<String, Object> push = received.stream().filter(r -> r.get("path").equals("/push/watch")).findFirst().orElseThrow();
        assertThat(push.get("encoding")).isEqualTo("aes128gcm");
        assertThat((String) push.get("authorization")).startsWith("vapid t=").contains("k=" + WebPushCrypto.b64(VAPID[0]));
        String text = new String(WebPushCryptoTest.decrypt((byte[]) push.get("body"), WebPushCrypto.unb64(UA_PUBLIC), WebPushCrypto.unb64(UA_PRIVATE),
                WebPushCrypto.unb64(AUTH)), StandardCharsets.UTF_8);
        assertThat(text).contains("PUSH растёт на 2,5% за 5 минут", "/app/#screener:PUSHUSDT");
        assertThat(received.stream().filter(r -> r.get("path").equals("/push/watch"))).as("only its pair").hasSize(1);
    }

    @Test
    void aSubscriptionThePushServiceForgotIsDeleted() {
        subscribe("gone", List.of(), false, "en");
        assertThat(repository.findByEndpoint(endpoint("gone"))).isPresent();

        fire("GONEUSDT", 3);

        assertThat(await(() -> repository.findByEndpoint(endpoint("gone")).isEmpty())).isTrue();
    }

    @Test
    void aStrangerOrBrokenSubscriptionIsRefused() {
        var request = new PushService.Request("https://evil.example/push", new PushService.Keys(UA_PUBLIC, AUTH), List.of(), true, "en");
        assertThat(controller.subscribe(request, new MockHttpServletRequest()).getStatusCode().value()).isEqualTo(400);
        var noKeys = new PushService.Request(endpoint("x"), new PushService.Keys("AAAA", AUTH), List.of(), true, "en");
        assertThat(controller.subscribe(noKeys, new MockHttpServletRequest()).getStatusCode().value()).isEqualTo(400);
    }

    private static boolean await(BooleanSupplier condition) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean()) {
                return true;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }
}
