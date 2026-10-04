package dev.pulse.stream;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import dev.pulse.depth.DensityScanner;
import dev.pulse.market.MarketStore;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.json.JsonMapper;

/**
 * Read-only market feed. Clients never send anything meaningful; the server pushes
 * a snapshot on connect and deltas afterwards.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MarketSocketHandler extends TextWebSocketHandler {

    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int BUFFER_LIMIT_BYTES = 4 * 1024 * 1024;

    private final MarketStore store;
    private final DensityScanner density;
    private final JsonMapper mapper;
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        // the decorator serializes concurrent sends and closes clients that fall too far behind
        WebSocketSession safe = new ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_LIMIT_BYTES);
        sessions.put(session.getId(), safe);
        long now = System.currentTimeMillis();
        send(safe, new StreamMessage.Snapshot(now, store.snapshot(now), store.recentLiquidations(50)));
        send(safe, new StreamMessage.Sparklines(store.sparklines(24)));
        DensityScanner.DensityState walls = density.latest();
        send(safe, new StreamMessage.Walls(walls.ts(), walls.walls(), walls.coverage()));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
    }

    public boolean hasClients() {
        return !sessions.isEmpty();
    }

    public void broadcast(StreamMessage message) {
        if (sessions.isEmpty()) {
            return;
        }
        TextMessage text = new TextMessage(mapper.writeValueAsString(message));
        sessions.values().forEach(s -> send(s, text));
    }

    private void send(WebSocketSession session, StreamMessage message) {
        send(session, new TextMessage(mapper.writeValueAsString(message)));
    }

    private void send(WebSocketSession session, TextMessage text) {
        try {
            if (session.isOpen()) {
                session.sendMessage(text);
            }
        } catch (IOException | IllegalStateException e) {
            log.debug("dropping client {}: {}", session.getId(), e.getMessage());
            sessions.remove(session.getId());
        }
    }
}
