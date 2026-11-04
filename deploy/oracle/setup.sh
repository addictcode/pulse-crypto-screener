#!/usr/bin/env bash
# Sets up an Oracle Cloud Always Free instance (Ubuntu 24.04, ARM, VM.Standard.A1.Flex) for Pulse
# and starts it. cloud-init.yaml runs it on the first boot; it is safe to run again by hand:
#   sudo bash /opt/pulse/deploy/oracle/setup.sh
#
# Settings come from /etc/pulse/install.env (written by cloud-init.yaml) or the environment:
#   PULSE_DOMAIN   the site's domain, e.g. mypulse.duckdns.org; empty: set up, but do not start
#   DUCKDNS_TOKEN  for a *.duckdns.org domain: keeps it pointed at this server
#   REPO, BRANCH   where Pulse comes from
#   PULSE_START    0 to set up without starting the stack (tests)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

if [ -f /etc/pulse/install.env ]; then
  # shellcheck source=/dev/null
  . /etc/pulse/install.env
fi
PULSE_DOMAIN=${PULSE_DOMAIN:-}
DUCKDNS_TOKEN=${DUCKDNS_TOKEN:-}
REPO=${REPO:-https://github.com/addictcode/pulse-crypto-screener.git}
BRANCH=${BRANCH:-main}
PULSE_START=${PULSE_START:-1}
APP_DIR=/opt/pulse
# the image's own user: Oracle puts the SSH key from the console there
LOGIN_USER=${LOGIN_USER:-ubuntu}

log() { printf '\n== %s\n' "$*"; }

log "Packages and security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install docker.io docker-compose-v2 git curl openssl fail2ban unattended-upgrades \
  iptables-persistent netfilter-persistent

# security updates every night, a reboot at 04:30 UTC when one needs it; the stack comes back by
# itself (restart: unless-stopped)
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52pulse-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
CONF

log "Firewall: 22, 80 and 443 only"
# Oracle's Ubuntu images do not use ufw: their iptables rules (/etc/iptables/rules.v4) accept SSH and
# reject everything else. Web ports go in right before that reject, live and in the file, so they
# survive a reboot. Postgres and the backend publish no ports at all.
RULES=/etc/iptables/rules.v4
open_port() { # proto port
  local spec=(-p "$1" -m state --state NEW -m "$1" --dport "$2" -j ACCEPT)
  if ! iptables -C INPUT "${spec[@]}" 2>/dev/null; then
    local at
    at=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
    iptables -I INPUT "${at:-1}" "${spec[@]}"
  fi
  local line="-A INPUT ${spec[*]}"
  if [ -f "$RULES" ] && ! grep -qF -- "$line" "$RULES"; then
    if grep -q '^-A INPUT -j REJECT' "$RULES"; then
      sed -i "0,/^-A INPUT -j REJECT/s//${line//\//\\/}\n&/" "$RULES"
    else
      sed -i "/^COMMIT/i ${line//\//\\/}" "$RULES"
    fi
  fi
}
if [ ! -f "$RULES" ]; then
  # not an Oracle image: start from the same idea, ssh in, everything else out
  install -d /etc/iptables
  cat > "$RULES" <<'CONF'
*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
-A INPUT -p icmp -j ACCEPT
-A INPUT -i lo -j ACCEPT
-A INPUT -p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT
-A INPUT -j REJECT --reject-with icmp-host-prohibited
COMMIT
CONF
  iptables-restore < "$RULES"
fi
open_port tcp 80
open_port tcp 443
open_port udp 443
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  # two firewalls fight; Oracle's rules are the ones the console documents
  ufw disable
fi

log "Swap, for the peak of building the Java image"
if ! swapon --show 2>/dev/null | grep -q /swapfile; then
  if [ ! -f /swapfile ]; then
    { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; } || rm -f /swapfile
  fi
  if swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  else
    echo "swap could not be turned on here, going on without it"
  fi
fi

log "User pulse: runs the stack, deploys log in as it"
id pulse >/dev/null 2>&1 || useradd --create-home --shell /bin/bash pulse
usermod -aG docker pulse
install -d -m 700 -o pulse -g pulse /home/pulse/.ssh
touch /home/pulse/.ssh/authorized_keys
if [ -f "/home/$LOGIN_USER/.ssh/authorized_keys" ]; then
  # the key given in the Oracle console works for pulse too; keys added later are kept
  sort -u "/home/$LOGIN_USER/.ssh/authorized_keys" /home/pulse/.ssh/authorized_keys -o /home/pulse/.ssh/authorized_keys
fi
chown pulse:pulse /home/pulse/.ssh/authorized_keys
chmod 600 /home/pulse/.ssh/authorized_keys

log "SSH: keys only"
install -d /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/60-pulse.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
CONF
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  systemctl enable --now docker
  systemctl enable --now fail2ban
  systemctl enable netfilter-persistent
  systemctl reload ssh || systemctl reload sshd || true
fi

log "Pulse in $APP_DIR"
git config --system --add safe.directory "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R pulse:pulse "$APP_DIR"
ENV_FILE=$APP_DIR/.env
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" "$ENV_FILE"
fi
if [ -n "$PULSE_DOMAIN" ]; then
  sed -i "s/^PULSE_DOMAIN=.*/PULSE_DOMAIN=$PULSE_DOMAIN/" "$ENV_FILE"
fi
chown pulse:pulse "$ENV_FILE"
chmod 600 "$ENV_FILE"

if [ -n "$DUCKDNS_TOKEN" ] && [[ "$PULSE_DOMAIN" == *.duckdns.org ]]; then
  log "DuckDNS: ${PULSE_DOMAIN} follows this server's address"
  sub=${PULSE_DOMAIN%.duckdns.org}
  install -d -m 700 /etc/pulse
  printf 'url="https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' "$sub" "$DUCKDNS_TOKEN" > /etc/pulse/duckdns.curl
  chmod 600 /etc/pulse/duckdns.curl
  echo '*/10 * * * * root curl -fsS -K /etc/pulse/duckdns.curl -o /dev/null' > /etc/cron.d/pulse-duckdns
  curl -fsS -K /etc/pulse/duckdns.curl -o /dev/null || echo "DuckDNS did not answer; the cron job will try again"
fi

log "Cron: nightly database dump (two weeks in /home/pulse/backups), uptime heartbeat"
# 03:40 UTC, before the 04:30 reboot window of the security updates; deploys also dump first
echo '40 3 * * * pulse cd /opt/pulse && deploy/backup.sh nightly >> /home/pulse/backup.log 2>&1' > /etc/cron.d/pulse-backup
chmod 644 /etc/cron.d/pulse-backup
# the uptime alarm: pings PULSE_HEARTBEAT_URL from .env while the site answers (empty: does nothing)
echo '* * * * * pulse /opt/pulse/deploy/heartbeat.sh > /dev/null 2>&1' > /etc/cron.d/pulse-heartbeat
chmod 644 /etc/cron.d/pulse-heartbeat

domain=$(sed -n 's/^PULSE_DOMAIN=//p' "$ENV_FILE")
if [ "$PULSE_START" != 1 ]; then
  log "Set up; not started (PULSE_START=$PULSE_START)"
elif [ -z "$domain" ] || [ "$domain" = pulse-example.duckdns.org ]; then
  log "Set up. Put your domain into PULSE_DOMAIN in $ENV_FILE, then: sudo -u pulse docker compose -f $APP_DIR/compose.prod.yaml up -d --build"
else
  log "Starting Pulse for $domain (the first build takes 5-10 minutes)"
  sudo -u pulse -H bash -c "cd '$APP_DIR' && docker compose -f compose.prod.yaml up -d --build"
  log "Done. https://$domain"
fi
