package dev.pulse.telegram;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
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
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import dev.pulse.TestcontainersConfiguration;
import dev.pulse.premium.PremiumService;

/**
 * Premium in Telegram Stars, switched on, against a fake Bot API: the invoice, the pre-checkout
 * answer, and the payment that turns premium on. That it stays off by default is in OpenBotIT.
 */
@SpringBootTest(properties = {
        "pulse.binance.enabled=false",
        "pulse.signals.enabled=false",
        "pulse.telegram.enabled=true",
        "pulse.telegram.token=TEST-TOKEN",
        "pulse.telegram.owner-chat-id=42",
        "pulse.telegram.open=true",
        "pulse.premium.enabled=true",
        "pulse.premium.price-stars=250",
        "pulse.premium.days=30",
        "pulse.premium.perks[0]=Signals with no delay in the channel"})
@Import(TestcontainersConfiguration.class)
class PremiumBotIT {

    private static final long BUYER = 501;

    private static HttpServer telegram;
    private static final Queue<String> pendingUpdates = new ConcurrentLinkedQueue<>();
    /** "method body" of every call the bot made */
    private static final List<String> calls = new CopyOnWriteArrayList<>();
    private static final AtomicLong updateIds = new AtomicLong();
    /** setMyCommands comes once, at start, before any test clears the calls */
    private static final List<String> menus = new CopyOnWriteArrayList<>();

    @Autowired
    private PremiumService premium;

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
        telegram.createContext("/botTEST-TOKEN/setMyCommands", exchange -> {
            menus.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, "{\"ok\":true,\"result\":true}");
        });
        for (String method : List.of("sendMessage", "sendInvoice", "answerPreCheckoutQuery")) {
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
        calls.clear();
    }

    @Test
    void premiumIsInTheMenuWhileOnSale() {
        assertThat(await(() -> menus.stream().anyMatch(m -> m.contains("\"premium\"")))).isTrue();
    }

    @Test
    void premiumSendsAnInvoiceInStarsWithThePerks() {
        message(BUYER, "/premium");

        assertThat(awaitCall(c -> c.startsWith("sendMessage") && c.contains("Signals with no delay in the channel")
                && c.contains("250 Stars for 30 days"))).isTrue();
        assertThat(awaitCall(c -> c.startsWith("sendInvoice") && c.contains("\"currency\":\"XTR\"")
                && c.contains("\"amount\":250") && c.contains("\"payload\":\"pulse-premium\"") && c.contains("\"chat_id\":501"))).isTrue();
    }

    @Test
    void thePreCheckoutIsAnsweredYesForOurInvoiceAndNoForAStaleOne() {
        preCheckout("q-good", BUYER, 250, "pulse-premium");
        assertThat(awaitCall(c -> c.startsWith("answerPreCheckoutQuery") && c.contains("\"q-good\"") && c.contains("\"ok\":true"))).isTrue();

        preCheckout("q-stale", BUYER, 100, "pulse-premium");
        assertThat(awaitCall(c -> c.startsWith("answerPreCheckoutQuery") && c.contains("\"q-stale\"") && c.contains("\"ok\":false")
                && c.contains("no longer valid"))).isTrue();
    }

    @Test
    void aSuccessfulPaymentTurnsPremiumOnForThirtyDaysAndTellsTheOwner() {
        long chat = 502;
        payment(chat, "charge-502");

        assertThat(awaitCall(c -> c.startsWith("sendMessage") && c.contains("\"chat_id\":502") && c.contains("Premium is on until"))).isTrue();
        assertThat(awaitCall(c -> c.startsWith("sendMessage") && c.contains("\"chat_id\":42") && c.contains("charge-502"))).isTrue();
        assertThat(premium.activeUntil(chat, Instant.now())).hasValueSatisfying(until ->
                assertThat(Duration.between(Instant.now(), until).toDays()).isBetween(29L, 30L));

        // Telegram may deliver the same update again: still one payment
        payment(chat, "charge-502");
        assertThat(awaitCall(c -> c.contains("\"chat_id\":502") && c.contains("Premium is on until"))).isTrue();
        assertThat(Duration.between(Instant.now(), premium.activeUntil(chat, Instant.now()).orElseThrow()).toDays()).isLessThanOrEqualTo(30L);
    }

    @Test
    void paySupportReachesTheOwner() {
        message(503, "/paysupport paid twice");

        assertThat(awaitCall(c -> c.startsWith("sendMessage") && c.contains("\"chat_id\":42") && c.contains("paid twice"))).isTrue();
    }

    private static void message(long chatId, String text) {
        pendingUpdates.add("{\"update_id\":" + updateIds.incrementAndGet() + ",\"message\":{\"chat\":{\"id\":" + chatId
                + "},\"from\":{\"id\":" + chatId + ",\"username\":\"u" + chatId + "\"},\"text\":\"" + text + "\"}}");
    }

    private static void preCheckout(String id, long from, int amount, String payload) {
        pendingUpdates.add("{\"update_id\":" + updateIds.incrementAndGet() + ",\"pre_checkout_query\":{\"id\":\"" + id
                + "\",\"from\":{\"id\":" + from + "},\"currency\":\"XTR\",\"total_amount\":" + amount
                + ",\"invoice_payload\":\"" + payload + "\"}}");
    }

    private static void payment(long chatId, String chargeId) {
        pendingUpdates.add("{\"update_id\":" + updateIds.incrementAndGet() + ",\"message\":{\"chat\":{\"id\":" + chatId
                + "},\"from\":{\"id\":" + chatId + "},\"successful_payment\":{\"currency\":\"XTR\",\"total_amount\":250,"
                + "\"invoice_payload\":\"pulse-premium\",\"telegram_payment_charge_id\":\"" + chargeId
                + "\",\"provider_payment_charge_id\":\"\"}}}");
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
