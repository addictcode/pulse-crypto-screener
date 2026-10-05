package dev.pulse.signal;

/**
 * Kinds of tape events: the fast, loose feed shown as a live list, separate from the curated
 * signals that are stored and sent to Telegram.
 */
public enum TapeKind {
    PUMP_1M,
    PUMP_5M,
    DUMP_1M,
    DUMP_5M,
    VOLUME,
    OI_UP,
    OI_DOWN,
    LIQ_LONGS,
    LIQ_SHORTS
}
