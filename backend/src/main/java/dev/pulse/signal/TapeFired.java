package dev.pulse.signal;

import java.util.List;

/** Tape events found in one scan. */
public record TapeFired(List<TapeItem> items) {
}
