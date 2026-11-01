package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
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
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.market.Instrument;
import dev.pulse.market.Liquidation;
import dev.pulse.market.MarketStore;
import dev.pulse.market.PositionSide;
import dev.pulse.signal.Horizon;
import dev.pulse.signal.Signal;
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.SignalType;

/**
 * The daily digest against a fake Telegram Bot API: posted to the channel once in its hour, and
 * on request with /digest.
 */
@SpringBootTest(properties = {
        "pulse.binance.enabled=false",
        "pulse.signals.enabled=false",
        "pulse.telegram.enabled=true",
        "pulse.telegram.token=TEST-TOKEN",
        "pulse.telegram.owner-chat-id=42",
        "pulse.telegram.open=true",
        "pulse.telegram.channel=@pulse_digest",
        "pulse.telegram.channel-delay=1s",
        "pulse.telegram.digest-hour=9",
        "pulse.telegram.digest-lang=ru"})
@Import(TestcontainersConfiguration.class)
class DigestIT {

    private static HttpServer telegram;
    private static final Queue<String> pendingUpdates = new ConcurrentLinkedQueue<>();
    private static final List<String> sent = new CopyOnWriteArrayList<>();
    private static final AtomicLong updateIds = new AtomicLong();

    @Autowired
    private MarketStore market;
    @Autowired
    private SignalHistory history;
    @Autowired
    private TelegramBot bot;

    @BeforeAll
    static void startFakeTelegram() throws IOException {
        telegram = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        telegram.createContext("/botTEST-TOKEN/getUpdates", exchange -> {
            String update = pendingUpdates.poll();
            if (update == null) {
                sleep(100);
            }
            respond(exchange, "{\"ok\":true,\"result\":[" + (update == null ? "" : update) + "]}");
        });
        telegram.createContext("/botTEST-TOKEN/sendMessage", exchange -> {
            sent.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, "{\"ok\":true,\"result\":{}}");
        });
        telegram.createContext("/botTEST-TOKEN/setMyCommands", exchange -> respond(exchange, "{\"ok\":true,\"result\":true}"));
        telegram.createContext("/botTEST-TOKEN/getMe", exchange -> respond(exchange, "{\"ok\":true,\"result\":{\"username\":\"PulseTestBot\"}}"));
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
        market.onInstruments(List.of(new Instrument("DGSTUSDT", "DGST", "USDT"), new Instrument("CALMUSDT", "CALM", "USDT")));
        sent.clear();
    }

    @Test
    void theChannelGetsTheDigestOnceInItsHourWithTheDaysSharpestMove() {
        long now = System.currentTimeMillis();
        Signal pump = history.record(new Signal(null, SignalType.PUMP, "DGSTUSDT", now - 2 * 3_600_000L, 1.0, 17.3,
                "DGST jumps 17.3% in five minutes", "Price 1.0.").withDirection(1));
        history.recordOutcomes(Horizon.H1, Map.of(pump.id(), -4.2));
        market.onLiquidation(new Liquidation("DGSTUSDT", PositionSide.SHORT, 1.0, 2_500_000, now));

        // a day of its own: the bot's own loop may post for today if the build runs in that hour
        ZonedDateTime nine = ZonedDateTime.of(2030, 1, 1, 9, 1, 0, 0, ZoneOffset.UTC);
        assertThat(bot.postDigestIfDue(nine.withHour(8))).as("not its hour").isFalse();
        assertThat(bot.postDigestIfDue(nine)).isTrue();
        assertThat(bot.postDigestIfDue(nine.plusMinutes(30))).as("once a day").isFalse();

        assertThat(awaitSent(body -> body.contains("\"chat_id\":\"@pulse_digest\"") && body.contains("Pulse за сутки")
                && body.contains("DGST +17.3% за 5 мин") && body.contains("через час −4.2%")
                && body.contains("шорты $2.5M") && body.contains("Не финансовый совет"))).isTrue();
    }

    @Test
    void anyoneCanAskForTheDigest() {
        message(77, "/digest");
        assertThat(awaitSent(body -> body.contains("\"chat_id\":77") && body.contains("Pulse, the last 24 hours")
                && body.contains("Sharpest moves") && body.contains("Largest walls now"))).isTrue();

        message(77, "/digest ru");
        assertThat(awaitSent(body -> body.contains("\"chat_id\":77") && body.contains("Крупнейшие стены сейчас"))).isTrue();
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
