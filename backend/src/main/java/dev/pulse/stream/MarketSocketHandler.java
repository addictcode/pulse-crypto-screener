package dev.pulse.stream;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import dev.pulse.config.ClientAddress;
import dev.pulse.config.PulseProperties;
import dev.pulse.depth.DensityScanner;
import dev.pulse.market.MarketStore;
import dev.pulse.signal.SignalHistory;
import dev.pulse.signal.TapeDetector;
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
    private static final String ADDRESS = "pulse.address";

    private final MarketStore store;
    private final DensityScanner density;
    private final SignalHistory signals;
    private final ObjectProvider<TapeDetector> tape;
    private final JsonMapper mapper;
    private final PulseProperties properties;
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, Integer> perAddress = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws IOException {
        InetSocketAddress remote = session.getRemoteAddress();
        String address = ClientAddress.of(session.getHandshakeHeaders(), remote == null ? null : remote.getHostString());
        if (!admit(address)) {
            // turned away before the snapshot, which is the expensive half megabyte
            log.debug("stream full for {}", address);
            session.close(CloseStatus.SERVICE_OVERLOAD);
            return;
        }
        session.getAttributes().put(ADDRESS, address);
        // the decorator serializes concurrent sends and closes clients that fall too far behind
        WebSocketSession safe = new ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_LIMIT_BYTES);
        sessions.put(session.getId(), safe);
        long now = System.currentTimeMillis();
        send(safe, new StreamMessage.Snapshot(now, store.snapshot(now), store.recentLiquidations(50)));
        send(safe, new StreamMessage.Sparklines(store.sparklines(24)));
        DensityScanner.DensityState walls = density.latest();
        send(safe, new StreamMessage.Walls(walls.ts(), walls.walls(), walls.coverage()));
        send(safe, new StreamMessage.Signals(signals.recent(30)));
        TapeDetector detector = tape.getIfAvailable();
        if (detector != null) {
            send(safe, new StreamMessage.Tape(detector.recent(80)));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
        // the attribute goes with the first release, so a session is never counted out twice
        release((String) session.getAttributes().remove(ADDRESS));
    }

    /** Counts the client in if there is room for it, overall and from its address. */
    boolean admit(String address) {
        PulseProperties.Limits limits = properties.limits();
        if (sessions.size() >= limits.streamClients()) {
            return false;
        }
        boolean[] admitted = {false};
        perAddress.compute(address, (k, n) -> {
            int count = n == null ? 0 : n;
            if (count >= limits.streamClientsPerAddress()) {
                return n;
            }
            admitted[0] = true;
            return count + 1;
        });
        return admitted[0];
    }

    void release(String address) {
        if (address != null) {
            perAddress.computeIfPresent(address, (k, n) -> n > 1 ? n - 1 : null);
        }
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
