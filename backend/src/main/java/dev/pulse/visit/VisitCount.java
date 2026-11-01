package dev.pulse.visit;

import java.time.LocalDate;

/** One row of the funnel: how many times a step happened on a day, from one kind of source. */
public record VisitCount(LocalDate day, FunnelStep step, VisitSource source, long count) {
}
