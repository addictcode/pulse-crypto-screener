package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarketStore;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalFired;
import dev.pulse.signal.SignalType;

/**
 * The bot against a fake Telegram Bot API: long polling, owner-only replies and signal delivery,
 * without a real token or network.
 */
@SpringBootTest(properties = {
        "pulse.binance.enabled=false",
        "pulse.signals.enabled=false",
        "pulse.telegram.enabled=true",
        "pulse.telegram.token=TEST-TOKEN",
        "pulse.telegram.owner-chat-id=42"})
@Import(TestcontainersConfiguration.class)
class TelegramBotIT {

    private static final long OWNER = 42;
    private static final long STRANGER = 99;

    private static HttpServer telegram;
    private static final Queue<String> pendingUpdates = new ConcurrentLinkedQueue<>();
    private static final List<String> sent = new CopyOnWriteArrayList<>();
    private static final AtomicLong updateIds = new AtomicLong();

    @Autowired
    private MarketStore market;
    @Autowired
    private ApplicationEventPublisher events;

    @BeforeAll
    static void startFakeTelegram() throws IOException {
        telegram = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        telegram.createContext("/botTEST-TOKEN/getUpdates", exchange -> {
            String update = pendingUpdates.poll();
            if (update == null) {
                sleep(100); // a real long poll would hold the request; keep the loop from spinning
            }
            respond(exchange, "{\"ok\":true,\"result\":[" + (update == null ? "" : update) + "]}");
        });
        telegram.createContext("/botTEST-TOKEN/sendMessage", exchange -> {
            sent.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, "{\"ok\":true,\"result\":{}}");
        });
        telegram.createContext("/botTEST-TOKEN/setMyCommands", exchange -> respond(exchange, "{\"ok\":true,\"result\":true}"));
        telegram.start();
    }

    @AfterAll
    static void stopFakeTelegram() {
        telegram.stop(0);
    }

    @DynamicPropertySource
    static void telegramUrl(DynamicPropertyRegistry registry) {
        registry.add("pulse.telegram.api-url", () -> "http://127.0.0.1:" + telegram.getAddress().getPort());
    }

    @BeforeEach
    void setUp() {
        market.onInstruments(List.of(new Instrument("WIFUSDT", "WIF", "USDT")));
    }

    @Test
    void answersTheOwner() {
        message(OWNER, "/watch wif");

        assertThat(awaitSent(body -> body.contains("\"chat_id\":42") && body.contains("WIF added to your watchlist."))).isTrue();
    }

    @Test
    void strangersAreToldOnceAndThenIgnored() {
        message(STRANGER, "/status");
        message(STRANGER, "/status");

        assertThat(awaitSent(body -> body.contains("\"chat_id\":99") && body.contains("This is a private bot."))).isTrue();
        sleep(500);
        assertThat(sent.stream().filter(body -> body.contains("\"chat_id\":99"))).hasSize(1);
    }

    @Test
    void deliversSignalsAndFoldsABurstIntoADigest() {
        events.publishEvent(new SignalFired(signal(1, "WIF jumps 2.8% in five minutes")));
        assertThat(awaitSent(body -> body.contains("WIF jumps 2.8% in five minutes") && body.contains("\"parse_mode\":\"HTML\""))).isTrue();

        for (int i = 2; i <= 5; i++) {
            events.publishEvent(new SignalFired(signal(i, "WIF burst " + i)));
        }
        assertThat(awaitSent(body -> body.matches(".*<b>[3-4] signals</b>.*"))).as("backlog arrives as one digest").isTrue();
    }

    private static Signal signal(long id, String title) {
        return new Signal(id, SignalType.PUMP, "WIFUSDT", System.currentTimeMillis(), 0.84, 2.8, title, "Price 0.8421.");
    }

    private static void message(long chatId, String text) {
        pendingUpdates.add("{\"update_id\":" + updateIds.incrementAndGet() + ",\"message\":{\"chat\":{\"id\":" + chatId
                + "},\"from\":{\"username\":\"u" + chatId + "\"},\"text\":\"" + text + "\"}}");
    }

    private static boolean awaitSent(Predicate<String> match) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (sent.stream().anyMatch(match)) {
                return true;
            }
            sleep(50);
        }
        return false;
    }

    private static void respond(HttpExchange exchange, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(body);
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
