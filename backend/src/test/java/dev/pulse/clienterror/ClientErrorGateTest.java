package dev.pulse.clienterror;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

class ClientErrorGateTest {

    @Test
    void oneAddressIsLimitedPerMinute() {
        ClientErrorGate gate = new ClientErrorGate(() -> 0.99);
        long admitted = IntStream.range(0, 30).filter(i -> gate.admit("1.1.1.1", 1_000)).count();
        assertThat(admitted).isEqualTo(ClientErrorGate.PER_ADDRESS);
        assertThat(gate.admit("1.1.1.1", 1_000 + ClientErrorGate.WINDOW_MS)).isTrue();
    }

    @Test
    void aFloodFromEveryoneIsSampled() {
        double[] next = {0.99};
        ClientErrorGate gate = new ClientErrorGate(() -> next[0]);
        long admitted = IntStream.range(0, 200).filter(i -> gate.admit("10.0.0." + i, 5_000)).count();
        assertThat(admitted).isEqualTo(ClientErrorGate.FULL_RATE);
        next[0] = 0.01;
        assertThat(gate.admit("10.0.1.1", 5_000)).isTrue();
    }
}
