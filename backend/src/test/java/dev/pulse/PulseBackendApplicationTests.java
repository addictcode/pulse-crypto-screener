package dev.pulse;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "pulse.binance.enabled=false")
class PulseBackendApplicationTests {

    @Test
    void contextLoadsWithoutTouchingTheExchange() {
    }
}
