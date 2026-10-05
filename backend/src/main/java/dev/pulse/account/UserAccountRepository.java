package dev.pulse.account;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

interface UserAccountRepository extends JpaRepository<UserAccount, Long> {

    Optional<UserAccount> findByTelegramChatId(long chatId);

    List<UserAccount> findByTelegramChatIdIsNotNull();
}
