package dev.pulse.telegram;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

import tools.jackson.databind.JsonNode;

/**
 * The few Bot API calls Pulse needs, over plain HTTP. Long polling keeps a getUpdates request
 * open for up to 30 seconds, so the read timeout is longer than that.
 */
final class TelegramApi {

    static final int POLL_SECONDS = 30;

    /** Thrown when Telegram asks us to slow down. */
    static final class RateLimited extends RuntimeException {
        final long retryAfterSeconds;

        RateLimited(long retryAfterSeconds) {
            super("rate limited for " + retryAfterSeconds + " s");
            this.retryAfterSeconds = retryAfterSeconds;
        }
    }

    /** The chat is gone for us: the person blocked the bot or deleted their account. */
    static final class Blocked extends RuntimeException {
        Blocked(String message) {
            super(message);
        }
    }

    record Command(String command, String description) {
    }

    private final RestClient http;
    private final String token;

    TelegramApi(String apiUrl, String token) {
        this.token = token;
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        JdkClientHttpRequestFactory requests = new JdkClientHttpRequestFactory(client);
        requests.setReadTimeout(Duration.ofSeconds(POLL_SECONDS + 15));
        this.http = RestClient.builder().baseUrl(apiUrl + "/bot" + token).requestFactory(requests).build();
    }

    List<TelegramUpdate> getUpdates(long offset) {
        JsonNode body = http.get()
                .uri("/getUpdates?offset={offset}&timeout={timeout}&allowed_updates={types}", offset, POLL_SECONDS,
                        "[\"message\",\"pre_checkout_query\",\"callback_query\"]")
                .retrieve()
                .body(JsonNode.class);
        List<TelegramUpdate> updates = new ArrayList<>();
        for (JsonNode u : body.path("result")) {
            long id = u.path("update_id").asLong();
            JsonNode query = u.path("pre_checkout_query");
            if (query.isObject()) {
                updates.add(new TelegramUpdate(id, query.path("from").path("id").asLong(), null,
                        query.path("from").path("username").asString(null),
                        query.path("from").path("language_code").asString(null),
                        new TelegramUpdate.PreCheckout(query.path("id").asString(""), query.path("currency").asString(""),
                                query.path("total_amount").asInt(), query.path("invoice_payload").asString("")),
                        null));
                continue;
            }
            JsonNode press = u.path("callback_query");
            if (press.isObject()) {
                updates.add(new TelegramUpdate(id, press.path("message").path("chat").path("id").asLong(), null,
                        press.path("from").path("username").asString(null), press.path("from").path("language_code").asString(null), null, null,
                        new TelegramUpdate.Callback(press.path("id").asString(""), press.path("message").path("message_id").asLong(),
                                press.path("data").asString(""))));
                continue;
            }
            JsonNode message = u.path("message");
            JsonNode paid = message.path("successful_payment");
            TelegramUpdate.Payment payment = paid.isObject()
                    ? new TelegramUpdate.Payment(paid.path("currency").asString(""), paid.path("total_amount").asInt(),
                            paid.path("invoice_payload").asString(""), paid.path("telegram_payment_charge_id").asString(""))
                    : null;
            updates.add(new TelegramUpdate(
                    id,
                    message.path("chat").path("id").asLong(),
                    message.path("text").isString() ? message.path("text").asString() : null,
                    message.path("from").path("username").asString(null),
                    message.path("from").path("language_code").asString(null),
                    null,
                    payment));
        }
        return updates;
    }

    /** An invoice in Telegram Stars: no payment provider, one price line. */
    void sendInvoice(long chatId, String title, String description, String payload, String label, int stars) {
        post("/sendInvoice", Map.of(
                "chat_id", chatId,
                "title", title,
                "description", description,
                "payload", payload,
                "currency", "XTR",
                "prices", List.of(Map.of("label", label, "amount", stars))));
    }

    /** Yes or no to a pre-checkout query; a no shows the buyer {@code error}. */
    void answerPreCheckoutQuery(String queryId, boolean ok, String error) {
        post("/answerPreCheckoutQuery", ok
                ? Map.of("pre_checkout_query_id", queryId, "ok", true)
                : Map.of("pre_checkout_query_id", queryId, "ok", false, "error_message", error));
    }

    void sendMessage(long chatId, String html) {
        sendMessage((Object) chatId, html);
    }

    /** @param chatId a numeric id, or "@name" for a public channel */
    void sendMessage(Object chatId, String html) {
        post("/sendMessage", Map.of(
                "chat_id", chatId,
                "text", html,
                "parse_mode", "HTML",
                "link_preview_options", Map.of("is_disabled", true)));
    }

    /** A row of buttons under a message: [label, data] pairs, rows top to bottom. */
    record Button(String text, String data) {
    }

    void sendMessage(long chatId, String html, List<List<Button>> keyboard) {
        post("/sendMessage", Map.of(
                "chat_id", chatId,
                "text", html,
                "parse_mode", "HTML",
                "link_preview_options", Map.of("is_disabled", true),
                "reply_markup", markup(keyboard)));
    }

    /** Rewrites a message the bot sent, with its buttons: a pressed button updates the same message. */
    void editMessage(long chatId, long messageId, String html, List<List<Button>> keyboard) {
        try {
            post("/editMessageText", Map.of(
                    "chat_id", chatId,
                    "message_id", messageId,
                    "text", html,
                    "parse_mode", "HTML",
                    "link_preview_options", Map.of("is_disabled", true),
                    "reply_markup", markup(keyboard)));
        } catch (HttpClientErrorException.BadRequest e) {
            // "message is not modified": the same button pressed twice; nothing to change
        }
    }

    /** Stops the spinner on a pressed button, with a short note at the top of the chat if given. */
    void answerCallback(String callbackId, String note) {
        post("/answerCallbackQuery", note == null ? Map.of("callback_query_id", callbackId) : Map.of("callback_query_id", callbackId, "text", note));
    }

    private static Map<String, Object> markup(List<List<Button>> keyboard) {
        return Map.of("inline_keyboard", keyboard.stream()
                .map(row -> row.stream().map(b -> Map.of("text", b.text(), "callback_data", b.data())).toList())
                .toList());
    }

    void setMyCommands(List<Command> commands) {
        post("/setMyCommands", Map.of("commands", commands));
    }

    /** The bot's own @username, for links back to it. */
    String username() {
        return http.get().uri("/getMe").retrieve().body(JsonNode.class).path("result").path("username").asString("");
    }

    /** The token is part of every URL; never let it reach a log line. */
    String redact(String message) {
        return message == null || token.isEmpty() ? message : message.replace(token, "***");
    }

    private void post(String path, Object body) {
        try {
            http.post().uri(path).contentType(MediaType.APPLICATION_JSON).body(body).retrieve().toBodilessEntity();
        } catch (HttpClientErrorException.TooManyRequests e) {
            JsonNode error = e.getResponseBodyAs(JsonNode.class);
            long retryAfter = error == null ? 5 : error.path("parameters").path("retry_after").asLong(5);
            throw new RateLimited(retryAfter);
        } catch (HttpClientErrorException.Forbidden e) {
            throw new Blocked(redact(e.getMessage()));
        }
    }
}
