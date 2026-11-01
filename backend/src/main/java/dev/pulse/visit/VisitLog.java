package dev.pulse.visit;

import java.time.LocalDate;
import java.util.List;

/** The funnel counters. An interface so the API can be tested without a database. */
public interface VisitLog {

    void count(LocalDate day, FunnelStep step, VisitSource source);

    /** Every row from {@code from} on, oldest day first. */
    List<VisitCount> since(LocalDate from);
}
