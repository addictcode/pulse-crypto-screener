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
import java.util.function.BooleanSupplier;
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
import dev.pulse.account.AccountService;
import dev.pulse.market.Instrument;
import dev.pulse.market.MarketStore;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalFired;
import dev.pulse.signal.SignalType;

/**
 * The bot open to everyone, with a channel, against a fake Telegram Bot API.
 */
@SpringBootTest(properties = {
        "pulse.binance.enabled=false",
        "pulse.signals.enabled=false",
        "pulse.telegram.enabled=true",
        "pulse.telegram.token=TEST-TOKEN",
        "pulse.telegram.owner-chat-id=42",
        "pulse.telegram.open=true",
        "pulse.telegram.channel=@pulse_test",
        "pulse.telegram.channel-delay=1s"})
@Import(TestcontainersConfiguration.class)
class OpenBotIT {

    private static final long VISITOR = 77;
    private static final long BLOCKED = 66;

    private static HttpServer telegram;
    private static final Queue<String> pendingUpdates = new ConcurrentLinkedQueue<>();
    private static final List<String> sent = new CopyOnWriteArrayList<>();
    private static final AtomicLong updateIds = new AtomicLong();
    private static final AtomicLong signalIds = new AtomicLong();

    @Autowired
    private MarketStore market;
    @Autowired
    private AccountService accounts;
    @Autowired
    private ApplicationEventPublisher events;

    @BeforeAll
    static void startFakeTelegram() throws IOException {
        telegram = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        telegram.createContext("/botTEST-TOKEN/getUpdates", exchange -> {
            String update = pendingUpdates.poll();
            if (update == null) {
                sleep(100);
            }
            respond(exchange, 200, "{\"ok\":true,\"result\":[" + (update == null ? "" : update) + "]}");
        });
        telegram.createContext("/botTEST-TOKEN/sendMessage", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (body.contains("\"chat_id\":" + BLOCKED)) {
                respond(exchange, 403, "{\"ok\":false,\"error_code\":403,\"description\":\"Forbidden: bot was blocked by the user\"}");
                return;
            }
            sent.add(body);
            respond(exchange, 200, "{\"ok\":true,\"result\":{}}");
        });
        telegram.createContext("/botTEST-TOKEN/setMyCommands", exchange -> respond(exchange, 200, "{\"ok\":true,\"result\":true}"));
        telegram.createContext("/botTEST-TOKEN/getMe", exchange ->
                respond(exchange, 200, "{\"ok\":true,\"result\":{\"username\":\"PulseTestBot\"}}"));
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
        sent.clear();
    }

    @Test
    void anyoneCanStartAndStop() {
        message(VISITOR, "/start");
        assertThat(awaitSent(body -> body.contains("\"chat_id\":77") && body.contains("Signals start now"))).isTrue();

        fire("WIF jumps 2.8% for the visitor", 2.8);
        assertThat(awaitSent(body -> body.contains("\"chat_id\":77") && body.contains("for the visitor"))).isTrue();

        message(VISITOR, "/stop");
        assertThat(awaitSent(body -> body.contains("\"chat_id\":77") && body.contains("Stopped."))).isTrue();
        fire("WIF jumps after the stop", 2.8);
        assertThat(awaitSent(body -> body.contains("\"chat_id\":42") && body.contains("after the stop"))).as("the owner still gets it").isTrue();
        assertThat(sent.stream().filter(body -> body.contains("\"chat_id\":77") && body.contains("after the stop"))).isEmpty();
    }

    @Test
    void onlyTheOwnerSeesTheSiteFunnel() {
        message(VISITOR, "/visits");

        assertThat(awaitSent(body -> body.contains("\"chat_id\":77") && body.contains("Unknown command"))).isTrue();
        assertThat(sent.stream().filter(body -> body.contains("\"chat_id\":77") && body.contains("Visits"))).isEmpty();
    }

    @Test
    void whoeverBlocksTheBotIsUnsubscribed() {
        accounts.subscribe(BLOCKED);

        fire("WIF jumps for the one who left", 2.8);

        assertThat(await(() -> accounts.telegramRecipients().stream().noneMatch(r -> r.telegramChatId() == BLOCKED))).isTrue();
    }

    @Test
    void strongSignalsReachTheChannelLaterWithALinkToTheBot() {
        fire("WIF jumps 5% in five minutes", 5.0);
        fire("WIF jumps a little", 2.2);

        assertThat(awaitSent(body -> body.contains("\"chat_id\":\"@pulse_test\"") && body.contains("WIF jumps 5%")
                && body.contains("@PulseTestBot"))).isTrue();
        assertThat(sent.stream().filter(body -> body.contains("@pulse_test") && body.contains("a little"))).isEmpty();
    }

    private void fire(String title, double value) {
        events.publishEvent(new SignalFired(new Signal(signalIds.incrementAndGet(), SignalType.PUMP, "WIFUSDT",
                System.currentTimeMillis(), 0.84, value, title, "Price 0.84.")));
    }

    private static void message(long chatId, String text) {
        pendingUpdates.add("{\"update_id\":" + updateIds.incrementAndGet() + ",\"message\":{\"chat\":{\"id\":" + chatId
                + "},\"from\":{\"username\":\"u" + chatId + "\"},\"text\":\"" + text + "\"}}");
    }

    private static boolean awaitSent(Predicate<String> match) {
        return await(() -> sent.stream().anyMatch(match));
    }

    private static boolean await(BooleanSupplier condition) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (condition.getAsBoolean()) {
                return true;
            }
            sleep(50);
        }
        return false;
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, body.length);
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
