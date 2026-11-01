package dev.pulse.premium;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import dev.pulse.TestcontainersConfiguration;

@SpringBootTest(properties = {"pulse.binance.enabled=false", "pulse.signals.enabled=false",
        "pulse.premium.enabled=true", "pulse.premium.price-stars=250", "pulse.premium.days=30"})
@Import(TestcontainersConfiguration.class)
class PremiumServiceIT {

    private static final Instant NOW = Instant.parse("2026-11-01T12:00:00Z");

    @Autowired
    private PremiumService premium;

    @Test
    void aPaymentBuysThirtyDaysAndAnEarlyOneAddsToThem() {
        long chat = 9_001;
        assertThat(premium.active(chat, NOW)).isFalse();

        Instant first = premium.recordPayment(chat, "charge-a", 250, NOW);
        assertThat(first).isEqualTo(NOW.plus(Duration.ofDays(30)));
        assertThat(premium.active(chat, NOW.plus(Duration.ofDays(29)))).isTrue();
        assertThat(premium.active(chat, NOW.plus(Duration.ofDays(31)))).isFalse();

        Instant second = premium.recordPayment(chat, "charge-b", 250, NOW.plus(Duration.ofDays(10)));
        assertThat(second).as("paid before the end: added on top").isEqualTo(NOW.plus(Duration.ofDays(60)));
    }

    @Test
    void theSameChargeTwiceIsOnePayment() {
        long chat = 9_002;
        Instant until = premium.recordPayment(chat, "charge-c", 250, NOW);

        assertThat(premium.recordPayment(chat, "charge-c", 250, NOW.plus(Duration.ofDays(1)))).isEqualTo(until);
        assertThat(premium.activeUntil(chat, NOW)).contains(until);
    }

    @Test
    void aPaymentAfterTheEndStartsAFreshPeriod() {
        long chat = 9_003;
        premium.recordPayment(chat, "charge-d", 250, NOW);
        Instant later = NOW.plus(Duration.ofDays(45));

        assertThat(premium.recordPayment(chat, "charge-e", 250, later)).isEqualTo(later.plus(Duration.ofDays(30)));
    }

    @Test
    void onlyOurInvoiceAtTodaysPriceInStarsIsAccepted() {
        assertThat(premium.acceptable(PremiumProperties.PAYLOAD, "XTR", 250)).isTrue();
        assertThat(premium.acceptable(PremiumProperties.PAYLOAD, "XTR", 100)).as("an old price").isFalse();
        assertThat(premium.acceptable(PremiumProperties.PAYLOAD, "USD", 250)).isFalse();
        assertThat(premium.acceptable("something-else", "XTR", 250)).isFalse();
    }
}
