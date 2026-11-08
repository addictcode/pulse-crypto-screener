package dev.pulse.visit;

import java.util.Arrays;
import java.util.Optional;

/**
 * A step of the way from a video to the bot. The key is what the page sends and what the table
 * stores; the label is the column head in the bot's report, short enough for a phone.
 */
public enum FunnelStep {
    LANDING("landing", "site", true),
    APP("app", "app", true),
    RECORD("record", "rec", true),
    CLIP("clip", "clip", true),
    BOT_CLICK("bot-click", "→bot", true),
    CHANNEL_CLICK("channel-click", "→ch", true),
    /** The game at /play/ opened, and a whole series of rounds played to the end. */
    PLAY("play", "play", true),
    PLAY_DONE("play-done", "done", true),
    /** Counted by the bot itself on /start, never accepted from a page. */
    BOT_START("bot-start", "/st", false);

    private final String key;
    private final String label;
    private final boolean fromPage;

    FunnelStep(String key, String label, boolean fromPage) {
        this.key = key;
        this.label = label;
        this.fromPage = fromPage;
    }

    public String key() {
        return key;
    }

    public String label() {
        return label;
    }

    /** Whether a page may report this step; the rest only the server counts. */
    public boolean fromPage() {
        return fromPage;
    }

    public static Optional<FunnelStep> fromKey(String key) {
        return Arrays.stream(values()).filter(s -> s.key.equals(key)).findFirst();
    }
}
