package dev.pulse.depth;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * The set of order books currently maintained. Exchange feeds decide which symbols to track and
 * feed events in; the density scanner reads views out.
 */
@Component
public class OrderBookStore {

    private final Map<String, OrderBook> books = new ConcurrentHashMap<>();

    public void track(String symbol) {
        books.computeIfAbsent(symbol, OrderBook::new);
    }

    public void untrack(String symbol) {
        books.remove(symbol);
    }

    public Set<String> tracked() {
        return Set.copyOf(books.keySet());
    }

    public boolean isTracked(String symbol) {
        return books.containsKey(symbol);
    }

    public Collection<OrderBook> books() {
        return List.copyOf(books.values());
    }

    public long syncedCount() {
        return books.values().stream().filter(OrderBook::isSynced).count();
    }

    /** Events for symbols that are not tracked (e.g. just dropped from the top list) are ignored. */
    public OrderBook.Status onUpdate(DepthUpdate update) {
        OrderBook book = books.get(update.symbol());
        return book == null ? OrderBook.Status.APPLIED : book.onUpdate(update);
    }

    public boolean onSnapshot(DepthSnapshot snapshot) {
        OrderBook book = books.get(snapshot.symbol());
        return book == null || book.onSnapshot(snapshot);
    }

    public void resetAll() {
        books.values().forEach(OrderBook::reset);
    }
}
