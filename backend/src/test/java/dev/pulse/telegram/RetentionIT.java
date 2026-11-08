package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
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
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.SignalType;
import dev.pulse.visit.FunnelStep;
import dev.pulse.visit.VisitLog;
import dev.pulse.visit.VisitSource;

/**
 * What keeps people with the bot, against a fake Telegram: a calm start, buttons for presets and
 * pauses, the person's own language, invitations and the weekly summary. Each test uses its own
 * chat, so the order of tests does not matter.
 */
@SpringBootTest(properties = {
        "pulse.binance.enabled=false",
        "pulse.signals.enabled=false",
        "pulse.telegram.enabled=true",
        "pulse.telegram.token=TEST-TOKEN",
        "pulse.telegram.owner-chat-id=42",
        "pulse.telegram.open=true",
        "pulse.telegram.weekly-hour=-1"})
@Import(TestcontainersConfiguration.class)
class RetentionIT {

    private static HttpServer telegram;
    private static final Queue<String> pendingUpdates = new ConcurrentLinkedQueue<>();
    /** "method body" of every call the bot made */
    private static final List<String> calls = new CopyOnWriteArrayList<>();
    private static final AtomicLong updateIds = new AtomicLong();
    private static final AtomicLong ids = new AtomicLong(1_000_000);

    @Autowired
    private MarketStore market;
    @Autowired
    private ApplicationEventPublisher events;
    @Autowired
    private TelegramBot bot;
    @Autowired
    private SignalHistory history;
    @Autowired
    private AccountService accounts;
    @Autowired
    private VisitLog visits;

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
        for (String method : List.of("sendMessage", "editMessageText", "answerCallbackQuery", "setMyCommands")) {
            telegram.createContext("/botTEST-TOKEN/" + method, exchange -> {
                calls.add(method + " " + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                respond(exchange, "{\"ok\":true,\"result\":true}");
            });
        }
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
        market.onInstruments(List.of(new Instrument("WIFUSDT", "WIF", "USDT"), new Instrument("SOLUSDT", "SOL", "USDT")));
    }

    @Test
    void aNewcomerStartsCalmAndCanAskForEverythingWithAButton() {
        long chat = 901;
        message(chat, "/start", null);
        assertThat(awaitCall(c -> c.startsWith("sendMessage") && c.contains("\"chat_id\":901") && c.contains("calm to begin with")
                && c.contains("\"callback_data\":\"preset:calm\"") && c.contains("\"callback_data\":\"preset:all\""))).isTrue();

        fire("WIF jumps 2.8% for 901", 2.8);
        fire("WIF jumps 5% for 901", 5.0);
        assertThat(awaitCall(c -> c.contains("\"chat_id\":901") && c.contains("5% for 901"))).isTrue();
        assertThat(calls.stream().filter(c -> c.contains("\"chat_id\":901") && c.contains("2.8% for 901"))).as("calm: a 2.8% pump is not strong").isEmpty();

        press(chat, 55, "preset:all");
        assertThat(awaitCall(c -> c.startsWith("answerCallbackQuery") && c.contains("Preset: Everything"))).isTrue();
        assertThat(awaitCall(c -> c.startsWith("editMessageText") && c.contains("\"message_id\":55") && c.contains("funding"))).isTrue();

        fire("WIF jumps 2.8% again for 901", 2.8);
        assertThat(awaitCall(c -> c.contains("\"chat_id\":901") && c.contains("2.8% again for 901"))).isTrue();
    }

    @Test
    void aRussianTelegramGetsRussianSignalsAndEnglishCanBeChosen() {
        long chat = 902;
        message(chat, "/start", "ru");
        assertThat(awaitCall(c -> c.contains("\"chat_id\":902") && c.contains("Сигналы уже идут") && c.contains("Спокойно"))).isTrue();

        fire("WIF jumps 6% for 902", 6.0);
        assertThat(awaitCall(c -> c.contains("\"chat_id\":902") && c.contains("WIF растёт на 6,0% за 5 минут") && c.contains("Памп"))).isTrue();

        message(chat, "/status", "ru");
        assertThat(awaitCall(c -> c.contains("\"chat_id\":902") && c.contains("<b>Состояние</b>"))).isTrue();

        message(chat, "/lang en", "ru");
        assertThat(awaitCall(c -> c.contains("\"chat_id\":902") && c.contains("English from now on"))).isTrue();
        message(chat, "/status", "ru");
        assertThat(awaitCall(c -> c.contains("\"chat_id\":902") && c.contains("<b>Status</b>"))).as("the choice wins over the app").isTrue();
    }

    @Test
    void mutingTakesAButton() {
        long chat = 903;
        message(chat, "/start", null);
        message(chat, "/mute", null);
        assertThat(awaitCall(c -> c.contains("\"chat_id\":903") && c.contains("Pause signals for how long?") && c.contains("mute:1h"))).isTrue();

        press(chat, 77, "mute:1h");
        assertThat(awaitCall(c -> c.startsWith("editMessageText") && c.contains("\"chat_id\":903") && c.contains("Muted until"))).isTrue();
        assertThat(await(() -> accounts.settings(accounts.telegramUser(chat).getId()).mutedUntil() != null)).isTrue();
    }

    @Test
    void anInvitationIsCountedAsWhereThePersonCameFrom() {
        message(904, "/invite", null);
        assertThat(awaitCall(c -> c.contains("\"chat_id\":904") && c.contains("https://t.me/PulseTestBot?start=invite") && c.contains("no rewards"))).isTrue();

        message(905, "/start invite", null);
        assertThat(await(() -> visits.since(LocalDate.now(ZoneOffset.UTC)).stream()
                .anyMatch(r -> r.step() == FunnelStep.BOT_START && r.source() == VisitSource.INVITE))).isTrue();
    }

    @Test
    void theWeekComesOnceAndIsAboutTheirPairs() {
        long chat = 906;
        message(chat, "/start", null);
        message(chat, "/watch SOL", null);
        assertThat(awaitCall(c -> c.contains("\"chat_id\":906") && c.contains("SOL added to your watchlist"))).isTrue();
        history.record(new Signal(null, SignalType.DUMP, "SOLUSDT", System.currentTimeMillis() - 3 * 86_400_000L, 100, 8.4,
                "SOL falls 8.4% in five minutes", "", -1, null, null, null));

        bot.sendWeekly(Instant.now());
        assertThat(awaitCall(c -> c.contains("\"chat_id\":906") && c.contains("Your week on Pulse") && c.contains("SOL −8.4% in 5 min")
                && c.contains("/weekly off"))).isTrue();
        long before = calls.stream().filter(c -> c.contains("\"chat_id\":906") && c.contains("Your week")).count();
        bot.sendWeekly(Instant.now());
        assertThat(calls.stream().filter(c -> c.contains("\"chat_id\":906") && c.contains("Your week")).count()).as("once a week").isEqualTo(before);

        message(907, "/start", null);
        message(907, "/weekly off", null);
        assertThat(awaitCall(c -> c.contains("\"chat_id\":907") && c.contains("No more weekly summaries"))).isTrue();
        bot.sendWeekly(Instant.now());
        assertThat(calls.stream().filter(c -> c.contains("\"chat_id\":907") && c.contains("Your week"))).isEmpty();
    }

    private void fire(String title, double value) {
        events.publishEvent(new SignalFired(new Signal(ids.incrementAndGet(), SignalType.PUMP, "WIFUSDT", System.currentTimeMillis(), 0.84, value, title,
                "Price 0.84.", 1, null, null, null)));
    }

    private static void message(long chatId, String text, String language) {
        String lang = language == null ? "" : ",\"language_code\":\"" + language + "\"";
        pendingUpdates.add("{\"update_id\":" + updateIds.incrementAndGet() + ",\"message\":{\"chat\":{\"id\":" + chatId
                + "},\"from\":{\"id\":" + chatId + ",\"username\":\"u" + chatId + "\"" + lang + "},\"text\":\"" + text + "\"}}");
    }

    private static void press(long chatId, long messageId, String data) {
        pendingUpdates.add("{\"update_id\":" + updateIds.incrementAndGet() + ",\"callback_query\":{\"id\":\"cb" + updateIds.get()
                + "\",\"from\":{\"id\":" + chatId + "},\"message\":{\"message_id\":" + messageId + ",\"chat\":{\"id\":" + chatId + "}},\"data\":\"" + data + "\"}}");
    }

    private static boolean awaitCall(Predicate<String> match) {
        return await(() -> calls.stream().anyMatch(match));
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
