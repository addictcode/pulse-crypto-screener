package dev.pulse.signal;

import java.util.List;

/** Published when outcomes were filled in; carries the signals in their updated form. */
public record SignalsMeasured(List<Signal> signals) {
}
