package dev.pulse.premium;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

interface PremiumPaymentRepository extends JpaRepository<PremiumPayment, Long> {

    Optional<PremiumPayment> findByChargeId(String chargeId);

    Optional<PremiumPayment> findFirstByTelegramChatIdOrderByActiveUntilDesc(long telegramChatId);
}
