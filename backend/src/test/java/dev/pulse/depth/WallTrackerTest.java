package dev.pulse.depth;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

class WallTrackerTest {

    private final WallTracker tracker = new WallTracker();

    @Test
    void ageSurvivesABriefDisappearance() {
        tracker.bucketWidth("WIFUSDT", 1.0, 0.05);
        WallDetector.Detected wall = new WallDetector.Detected(BookSide.BID, 1_990, 0.995, 200_000, 12);

        tracker.update("WIFUSDT", 1.0, List.of(wall), 0, null);
        tracker.update("WIFUSDT", 1.0, List.of(), 5_000, null); // cancelled and re-placed
        List<Wall> walls = tracker.update("WIFUSDT", 1.0, List.of(wall), 8_000, null);

        assertThat(walls).singleElement().satisfies(w -> {
            assertThat(w.age()).isEqualTo(8);
            assertThat(w.distance()).isEqualTo(-0.5);
        });
    }

    @Test
    void ageRestartsAfterTheGracePeriod() {
        tracker.bucketWidth("WIFUSDT", 1.0, 0.05);
        WallDetector.Detected wall = new WallDetector.Detected(BookSide.ASK, 2_010, 1.005, 200_000, 12);

        tracker.update("WIFUSDT", 1.0, List.of(wall), 0, null);
        tracker.update("WIFUSDT", 1.0, List.of(), WallTracker.GRACE_MS + 1_000, null);
        List<Wall> walls = tracker.update("WIFUSDT", 1.0, List.of(wall), WallTracker.GRACE_MS + 2_000, null);

        assertThat(walls.getFirst().age()).isZero();
    }

    @Test
    void bucketGridStaysFixedUntilThePriceMovesFar() {
        double width = tracker.bucketWidth("WIFUSDT", 1.00, 0.05);

        assertThat(tracker.bucketWidth("WIFUSDT", 1.10, 0.05)).isEqualTo(width);
        assertThat(tracker.bucketWidth("WIFUSDT", 1.30, 0.05)).isNotEqualTo(width);
    }

    @Test
    void eatTimeComparesTheWallWithOneSideOfTheTape() {
        // $1M traded per minute, half of it hits the bids: a $2M bid wall lasts 4 minutes
        assertThat(WallTracker.eatMinutes(2_000_000, 1_000_000.0)).isEqualTo(4.0);
        assertThat(WallTracker.eatMinutes(2_000_000, null)).isNull();
    }
}
