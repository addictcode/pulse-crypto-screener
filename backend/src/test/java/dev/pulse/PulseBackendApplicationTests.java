package dev.pulse;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest(properties = "pulse.binance.enabled=false")
@Import(TestcontainersConfiguration.class)
class PulseBackendApplicationTests {

    @Test
    void contextLoadsAndMigrationsMatchTheEntities() {
        // ddl-auto=validate fails the context if Liquibase and the JPA mappings disagree
    }
}
