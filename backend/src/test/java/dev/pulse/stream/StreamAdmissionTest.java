package dev.pulse.stream;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import dev.pulse.config.PulseProperties;

class StreamAdmissionTest {

    private final MarketSocketHandler handler = new MarketSocketHandler(null, null, null, null, null,
            new PulseProperties(null, null, null, null, null, null, null, new PulseProperties.Limits(60, 10, 100, 2)));

    @Test
    void oneAddressGetsOnlyItsShare() {
        assertThat(handler.admit("1.1.1.1")).isTrue();
        assertThat(handler.admit("1.1.1.1")).isTrue();

        assertThat(handler.admit("1.1.1.1")).isFalse();
        assertThat(handler.admit("2.2.2.2")).isTrue();
    }

    @Test
    void aClosedConnectionFreesItsPlace() {
        handler.admit("1.1.1.1");
        handler.admit("1.1.1.1");

        handler.release("1.1.1.1");

        assertThat(handler.admit("1.1.1.1")).isTrue();
    }

    @Test
    void releasingWhatWasNeverCountedIsHarmless() {
        handler.release(null);
        handler.release("9.9.9.9");

        assertThat(handler.admit("9.9.9.9")).isTrue();
    }
}
