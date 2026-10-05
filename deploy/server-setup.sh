#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for Pulse. From your machine:
#   ssh root@HOST 'bash -s' < deploy/server-setup.sh
set -euo pipefail

REPO=${REPO:-https://github.com/addictcode/pulse-crypto-screener.git}
APP_DIR=/opt/pulse

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install docker.io docker-compose-v2 git ufw fail2ban unattended-upgrades
systemctl enable --now docker

# a small VPS can run out of memory while building the Java image; swap absorbs the peak
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# deploy user: runs docker, logs in with the same key as root
id pulse >/dev/null 2>&1 || useradd --create-home --shell /bin/bash pulse
usermod -aG docker pulse
install -d -m 700 -o pulse -g pulse /home/pulse/.ssh
install -m 600 -o pulse -g pulse /root/.ssh/authorized_keys /home/pulse/.ssh/authorized_keys

# ssh with keys only
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh

# firewall: ssh and web only. Postgres and the backend publish no ports, so Docker's own
# iptables rules (which bypass ufw) expose nothing beyond Caddy on 80/443.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
chown -R pulse:pulse "$APP_DIR"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" "$APP_DIR/.env"
  chown pulse:pulse "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

echo "Server ready. Set PULSE_DOMAIN (and the Telegram settings) in $APP_DIR/.env, then run deploy/deploy.sh."
