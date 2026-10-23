#!/usr/bin/env bash
# OS packages for the postgres job: Playwright's system dependencies for Chromium and Firefox
# (the same set `npx playwright install --with-deps chromium firefox` installs) plus the
# synthetic reference-audio encoder and the owned PulseAudio sink.
#
# The runner's default apt mirror (azure.archive.ubuntu.com) has stalled this job for over
# ten minutes at a time. The .deb files apt downloads are therefore cached per runner image
# and Playwright version and installed offline with dpkg; apt runs only on a cache miss
# (about once per runner-image release), with network timeouts, a 150-second wall clock and a
# fallback to archive.ubuntu.com.
#
# Usage: postgres-job-packages.sh <cache-hit: true|other>. Writes fresh=true|false to
# $GITHUB_OUTPUT; fresh=true means the cache directory was rebuilt and should be saved.
set -euo pipefail

debs="$HOME/.cache/ci-apt-debs"
audio=(ffmpeg pulseaudio pulseaudio-utils)
fresh=false

verify() {
  for tool in ffmpeg /usr/bin/pulseaudio /usr/bin/pactl; do
    command -v "$tool" >/dev/null || { echo "missing $tool after install"; return 1; }
  done
}

offline() {
  [ -f "$debs/.complete" ] || return 1
  if compgen -G "$debs/*.deb" >/dev/null; then
    for attempt in 1 2 3; do
      # dpkg does not wait for the lock that the runner's boot-time apt jobs may hold.
      if sudo dpkg -i "$debs"/*.deb >/dev/null; then break; fi
      if [ "$attempt" = 3 ]; then return 1; fi
      sleep 15
    done
  fi
  verify
}

online_once() {
  local seconds=$1
  sudo dpkg --configure -a || true
  # timeout runs as root so that, on expiry, its process-group kill reaches apt-get and its
  # download methods directly. Run as a user, it would signal only sudo, which does not relay
  # signals from its own process group, leaving apt-get holding the dpkg lock.
  # install-deps runs apt-get update and apt-get install itself (without sudo, as root).
  sudo env "PATH=$PATH" timeout -k 15 "$seconds" npx playwright install-deps chromium firefox &&
    sudo timeout -k 15 "$seconds" apt-get install -y --no-install-recommends "${audio[@]}"
}

online() {
  sudo tee /etc/apt/apt.conf.d/99ci-network >/dev/null <<'EOF'
Acquire::Retries "3";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
DPkg::Lock::Timeout "120";
APT::Keep-Downloaded-Packages "true";
Binary::apt::APT::Keep-Downloaded-Packages "true";
EOF
  sudo rm -f /var/cache/apt/archives/*.deb
  if ! online_once 150; then
    echo "::warning::The default apt mirror did not finish within 150 seconds; retrying against archive.ubuntu.com"
    for file in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources /etc/apt/apt-mirrors.txt; do
      if [ -f "$file" ]; then sudo sed -i 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g' "$file"; fi
    done
    online_once 300
  fi
  verify
  rm -rf "$debs" && mkdir -p "$debs"
  if compgen -G "/var/cache/apt/archives/*.deb" >/dev/null; then cp /var/cache/apt/archives/*.deb "$debs"/; fi
  touch "$debs/.complete"
  fresh=true
}

if [ "${1:-}" = "true" ] && offline; then
  echo "Installed $(compgen -G "$debs/*.deb" | wc -l) cached packages without apt"
else
  [ "${1:-}" = "true" ] && echo "::warning::Cached packages did not install; falling back to apt"
  online
fi
echo "fresh=$fresh" >> "$GITHUB_OUTPUT"
