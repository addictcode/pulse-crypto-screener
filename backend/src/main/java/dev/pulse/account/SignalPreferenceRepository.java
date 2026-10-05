package dev.pulse.account;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

interface SignalPreferenceRepository extends JpaRepository<SignalPreference, Long> {

    List<SignalPreference> findByUserId(long userId);
}
