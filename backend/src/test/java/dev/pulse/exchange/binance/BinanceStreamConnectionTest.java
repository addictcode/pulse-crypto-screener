package dev.pulse.exchange.binance;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import java.net.URI;
import java.net.http.WebSocket;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.Test;

class BinanceStreamConnectionTest {

    private final List<String> frames = new CopyOnWriteArrayList<>();
    private final BinanceStreamConnection connection = new BinanceStreamConnection("test", null, URI.create("wss://example"),
            List.of(), frames::add);

    @Test
    void fragmentsAreJoinedIntoOneFrame() {
        FakeSocket ws = new FakeSocket();
        connection.onOpen(ws.socket);

        connection.onText(ws.socket, "{\"s\":\"BTC", false);
        connection.onText(ws.socket, "USDT\"}", true);

        assertThat(frames).containsExactly("{\"s\":\"BTCUSDT\"}");
    }

    @Test
    void anOldSocketCannotSpliceItsFragmentsIntoTheNewOnes() {
        FakeSocket old = new FakeSocket();
        FakeSocket fresh = new FakeSocket();
        connection.onOpen(old.socket);
        connection.onText(old.socket, "{\"s\":\"BTCUSDT\",\"c\":\"", false);

        connection.onOpen(fresh.socket);
        connection.onText(old.socket, "0.04615\"}", true);
        connection.onText(fresh.socket, "{\"s\":\"TOSHIUSDT\",\"c\":\"0.00045\"}", true);

        assertThat(frames).containsExactly("{\"s\":\"TOSHIUSDT\",\"c\":\"0.00045\"}");
        assertThat(old.aborted).as("the leftover socket is closed").isTrue();
        assertThat(fresh.aborted).isFalse();
    }

    @Test
    void aLateCloseOfAnOldSocketLeavesTheCurrentOneAlone() {
        FakeSocket old = new FakeSocket();
        FakeSocket fresh = new FakeSocket();
        connection.onOpen(old.socket);
        connection.onOpen(fresh.socket);

        connection.onClose(old.socket, 1006, "gone");
        connection.onError(old.socket, new RuntimeException("reset"));
        connection.onText(fresh.socket, "{}", true);

        assertThat(frames).containsExactly("{}");
        assertThat(fresh.aborted).isFalse();
    }

    /** Just enough of a WebSocket to see whether it was aborted. */
    private static final class FakeSocket {
        boolean aborted;
        final WebSocket socket = (WebSocket) Proxy.newProxyInstance(WebSocket.class.getClassLoader(),
                new Class<?>[] {WebSocket.class}, (proxy, method, args) -> switch (method.getName()) {
                    case "abort" -> {
                        aborted = true;
                        yield null;
                    }
                    case "isInputClosed", "isOutputClosed" -> aborted;
                    case "sendText", "sendClose", "sendPing", "sendPong", "sendBinary" -> CompletableFuture.completedFuture(proxy);
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    case "toString" -> "FakeSocket";
                    default -> null;
                });
    }
}
