package dev.pulse.clienterror;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.DoubleSupplier;

/**
 * Keeps error reports from becoming a flood: {@link #PER_ADDRESS} a minute from one address (a
 * page sends at most five, a mobile operator puts many phones behind one address), and once more
 * than {@link #FULL_RATE} reports a minute arrive from everyone together, only one in
 * {@link #SAMPLE} is kept. A broken build seen by a thousand visitors is one error counted many
 * times, and a tenth of those counts still says so. Addresses live here a minute, never on disk.
 */
final class ClientErrorGate {

    static final long WINDOW_MS = 60_000;
    static final int PER_ADDRESS = 10;
    static final int FULL_RATE = 60;
    static final int SAMPLE = 10;
    static final int MAX_ENTRIES = 20_000;

    private record Window(long start, int hits) {
    }

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final DoubleSupplier random;
    private long minuteStart = Long.MIN_VALUE;
    private int minuteHits;

    ClientErrorGate() {
        this(() -> ThreadLocalRandom.current().nextDouble());
    }

    ClientErrorGate(DoubleSupplier random) {
        this.random = random;
    }

    /** @return true if this report is stored */
    boolean admit(String address, long now) {
        if (windows.size() >= MAX_ENTRIES && !windows.containsKey(address)) {
            windows.values().removeIf(w -> now - w.start() >= WINDOW_MS);
            if (windows.size() >= MAX_ENTRIES) {
                return false;
            }
        }
        boolean[] admitted = {false};
        windows.compute(address, (k, w) -> {
            if (w == null || now - w.start() >= WINDOW_MS) {
                admitted[0] = true;
                return new Window(now, 1);
            }
            admitted[0] = w.hits() < PER_ADDRESS;
            return admitted[0] ? new Window(w.start(), w.hits() + 1) : w;
        });
        return admitted[0] && sample(now);
    }

    private synchronized boolean sample(long now) {
        if (now - minuteStart >= WINDOW_MS) {
            minuteStart = now;
            minuteHits = 0;
        }
        minuteHits++;
        return minuteHits <= FULL_RATE || random.getAsDouble() < 1.0 / SAMPLE;
    }
}
