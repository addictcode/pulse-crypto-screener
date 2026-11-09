package dev.pulse.clienterror;

import java.time.Instant;
import java.util.List;

/** Browser errors counted by fingerprint, kept for a day. */
public interface ClientErrorLog {

    /** One more of this error; a new fingerprint becomes a row, a known one counts up. */
    void count(ClientError error, Instant at);

    /** Errors that appeared or grew since they were last reported, most frequent first. */
    List<Row> unreported();

    /** Marks these counts as told to the owner. */
    void reported(List<Row> rows);

    /** Forgets errors not seen since then. @return how many */
    int forgetBefore(Instant cutoff);

    /**
     * @param count    how many times in total
     * @param newCount how many since the last summary
     */
    record Row(String fingerprint, String message, String stack, String page, String build, String lang,
               long count, long newCount, Instant firstSeen, Instant lastSeen) {
    }
}
