package dev.pulse.depth;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class OrderBookTest {

    private final OrderBook book = new OrderBook("WIFUSDT");

    @Test
    void buffersUntilTheSnapshotThenReplaysOnlyEventsAfterIt() {
        assertThat(book.onUpdate(update(90, 95, 89, bid(1.00, 50)))).isEqualTo(OrderBook.Status.BUFFERED);
        assertThat(book.onUpdate(update(96, 105, 95, bid(1.01, 70)))).isEqualTo(OrderBook.Status.BUFFERED);
        assertThat(book.onUpdate(update(106, 110, 105, bid(1.02, 30)))).isEqualTo(OrderBook.Status.BUFFERED);

        assertThat(book.onSnapshot(snapshot(100))).isTrue();

        BookView view = book.view(5, 10);
        // event 90..95 predates the snapshot and is dropped; 96..105 straddles it; 106..110 continues
        assertThat(view.bidPrices()).containsExactly(1.02, 1.01, 1.00, 0.99);
        assertThat(view.bidQuantities()).containsExactly(30.0, 70.0, 10.0, 10.0);
    }

    @Test
    void aGapAfterSyncRequiresANewSnapshot() {
        book.onSnapshot(snapshot(100));
        assertThat(book.onUpdate(update(95, 101, 94, bid(1.00, 11)))).isEqualTo(OrderBook.Status.APPLIED);

        // pu should be 101, the event before was lost
        assertThat(book.onUpdate(update(110, 112, 108, bid(1.00, 12)))).isEqualTo(OrderBook.Status.NEEDS_SNAPSHOT);
        assertThat(book.isSynced()).isFalse();
    }

    @Test
    void snapshotOlderThanTheBufferedStreamIsRejected() {
        book.onUpdate(update(150, 160, 149, bid(1.00, 20)));

        assertThat(book.onSnapshot(snapshot(100))).as("events 101..149 are missing").isFalse();
        assertThat(book.isSynced()).isFalse();
        // the buffered event is kept, so the next snapshot can still use it
        assertThat(book.onSnapshot(snapshot(155))).isTrue();
        assertThat(book.view(5, 10).bidQuantities()[0]).isEqualTo(20.0);
    }

    @Test
    void zeroQuantityRemovesTheLevel() {
        book.onSnapshot(snapshot(100));
        book.onUpdate(update(100, 101, 99, bid(1.00, 0)));

        assertThat(book.view(5, 10).bidPrices()).containsExactly(0.99);
    }

    @Test
    void viewKeepsOnlyLevelsNearThePriceAndPrunesFarOnes() {
        book.onSnapshot(new DepthSnapshot("WIFUSDT", 100,
                new double[] {1.00, 0.97, 0.80}, new double[] {1, 1, 1},
                new double[] {1.01, 1.04, 1.30}, new double[] {1, 1, 1}));

        BookView view = book.view(5, 10);

        assertThat(view.bidPrices()).containsExactly(1.00, 0.97);
        assertThat(view.askPrices()).containsExactly(1.01, 1.04);
        assertThat(book.view(50, 50).bidPrices()).as("0.80 was pruned by the first view").containsExactly(1.00, 0.97);
    }

    private static DepthSnapshot snapshot(long lastUpdateId) {
        return new DepthSnapshot("WIFUSDT", lastUpdateId,
                new double[] {1.00, 0.99}, new double[] {10, 10},
                new double[] {1.03, 1.04}, new double[] {10, 10});
    }

    private static DepthUpdate update(long first, long last, long previous, double[][] bids) {
        return new DepthUpdate("WIFUSDT", first, last, previous, 0, bids[0], bids[1], new double[0], new double[0]);
    }

    private static double[][] bid(double price, double quantity) {
        return new double[][] {{price}, {quantity}};
    }
}
