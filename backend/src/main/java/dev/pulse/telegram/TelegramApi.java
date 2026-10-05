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
                .uri("/getUpdates?offset={offset}&timeout={timeout}&allowed_updates={types}", offset, POLL_SECONDS, "[\"message\"]")
                .retrieve()
                .body(JsonNode.class);
        List<TelegramUpdate> updates = new ArrayList<>();
        for (JsonNode u : body.path("result")) {
            JsonNode message = u.path("message");
            updates.add(new TelegramUpdate(
                    u.path("update_id").asLong(),
                    message.path("chat").path("id").asLong(),
                    message.path("text").isString() ? message.path("text").asString() : null,
                    message.path("from").path("username").asString(null)));
        }
        return updates;
    }

    void sendMessage(long chatId, String html) {
        post("/sendMessage", Map.of(
                "chat_id", chatId,
                "text", html,
                "parse_mode", "HTML",
                "link_preview_options", Map.of("is_disabled", true)));
    }

    void setMyCommands(List<Command> commands) {
        post("/setMyCommands", Map.of("commands", commands));
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
        }
    }
}
