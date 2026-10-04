package dev.pulse.depth;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Gives walls a memory across scans: when one first appeared, so the UI can tell a wall that has
 * held for an hour from one that was placed a second ago. Market makers often cancel and re-place
 * a wall to stay at the top of the queue, so a wall that vanishes briefly keeps its age.
 * <p>
 * Not thread safe: only the density scanner thread uses it.
 */
final class WallTracker {

    static final long GRACE_MS = 10_000;
    /** Rebuild the bucket grid when the price moved this much since it was chosen. */
    static final double REGRID_DRIFT = 0.2;

    private final Map<String, SymbolTrack> tracks = new HashMap<>();

    double bucketWidth(String symbol, double mid, double bucketPct) {
        SymbolTrack track = tracks.get(symbol);
        if (track == null || Math.abs(mid / track.referencePrice - 1) > REGRID_DRIFT) {
            track = new SymbolTrack(mid, WallDetector.bucketWidth(mid, bucketPct));
            tracks.put(symbol, track);
        }
        return track.bucketWidth;
    }

    /**
     * @param volumePerMinute recent traded value per minute in USD, or {@code null} if unknown
     */
    List<Wall> update(String symbol, double mid, List<WallDetector.Detected> detected, long now, Double volumePerMinute) {
        SymbolTrack track = tracks.get(symbol);
        if (track == null) {
            return List.of();
        }
        List<Wall> walls = new ArrayList<>(detected.size());
        for (WallDetector.Detected d : detected) {
            String key = d.side() + ":" + d.bucket();
            Seen seen = track.seen.computeIfAbsent(key, k -> new Seen(now));
            seen.lastSeen = now;
            walls.add(new Wall(
                    symbol,
                    d.side(),
                    d.price(),
                    Math.round(d.notional()),
                    round((d.price() / mid - 1) * 100, 3),
                    round(d.multiple(), 1),
                    (now - seen.firstSeen) / 1000,
                    eatMinutes(d.notional(), volumePerMinute)));
        }
        for (Iterator<Seen> it = track.seen.values().iterator(); it.hasNext(); ) {
            if (now - it.next().lastSeen > GRACE_MS) {
                it.remove();
            }
        }
        return walls;
    }

    void forget(String symbol) {
        tracks.remove(symbol);
    }

    /**
     * Only one side of the tape eats a given wall (sellers hit bids, buyers lift asks),
     * so the wall is compared with half of the traded value.
     */
    static Double eatMinutes(double notional, Double volumePerMinute) {
        if (volumePerMinute == null || volumePerMinute <= 0) {
            return null;
        }
        return round(notional / (volumePerMinute / 2), 1);
    }

    private static double round(double value, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }

    private static final class SymbolTrack {
        final double referencePrice;
        final double bucketWidth;
        final Map<String, Seen> seen = new HashMap<>();

        SymbolTrack(double referencePrice, double bucketWidth) {
            this.referencePrice = referencePrice;
            this.bucketWidth = bucketWidth;
        }
    }

    private static final class Seen {
        final long firstSeen;
        long lastSeen;

        Seen(long firstSeen) {
            this.firstSeen = firstSeen;
        }
    }
}
