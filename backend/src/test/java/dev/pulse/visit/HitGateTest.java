package dev.pulse.visit;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class HitGateTest {

    private final HitGate gate = new HitGate();

    @Test
    void phonesBehindOneAddressCountUpToALimitAMinute() {
        for (int i = 0; i < HitGate.PER_WINDOW; i++) {
            assertThat(gate.admit("1.1.1.1", FunnelStep.LANDING, i)).isTrue();
        }
        // more than that from one address in a minute is a script, not a crowd
        assertThat(gate.admit("1.1.1.1", FunnelStep.LANDING, HitGate.WINDOW_MS - 1)).isFalse();
        assertThat(gate.admit("1.1.1.1", FunnelStep.LANDING, HitGate.WINDOW_MS)).isTrue();
    }

    @Test
    void anotherPageOrAddressCountsOnItsOwn() {
        assertThat(gate.admit("1.1.1.1", FunnelStep.LANDING, 0)).isTrue();
        assertThat(gate.admit("1.1.1.1", FunnelStep.APP, 0)).isTrue();
        assertThat(gate.admit("2.2.2.2", FunnelStep.LANDING, 0)).isTrue();
    }

    @Test
    void aFloodOfAddressesStopsBeingCountedInsteadOfFillingMemory() {
        for (int i = 0; i < HitGate.MAX_ENTRIES; i++) {
            gate.admit("2001:db8::" + Integer.toHexString(i), FunnelStep.LANDING, 1_000);
        }
        // the gate is full of addresses seen within the minute: a new one is not counted
        assertThat(gate.admit("2001:db8::ffff:1", FunnelStep.LANDING, 2_000)).isFalse();
        assertThat(gate.size()).isEqualTo(HitGate.MAX_ENTRIES);

        // once they have expired, room is made and counting resumes
        assertThat(gate.admit("2001:db8::ffff:1", FunnelStep.LANDING, 1_000 + HitGate.WINDOW_MS)).isTrue();
        assertThat(gate.size()).isEqualTo(1);
    }
}
