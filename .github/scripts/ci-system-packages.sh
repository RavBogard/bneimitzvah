#!/usr/bin/env bash
# OS packages for a CI job: Playwright's system dependencies for the named browsers (the same
# set `npx playwright install --with-deps <browsers>` installs) plus any extra apt packages,
# such as the postgres job's synthetic reference-audio encoder and owned PulseAudio sink.
#
# The runner's default apt mirror (azure.archive.ubuntu.com) has stalled jobs for over ten
# minutes at a time. The .deb files apt downloads are therefore cached per job, runner image
# and Playwright version and installed offline with dpkg; apt runs only on a cache miss (about
# once per runner-image release), with network timeouts, a 150-second wall clock and a
# fallback to archive.ubuntu.com.
#
# Usage: ci-system-packages.sh <cache-hit: true|other> "<browsers>" [extra apt packages...]
# Writes fresh=true|false to $GITHUB_OUTPUT; fresh=true means the cache directory was rebuilt
# and should be saved.
set -euo pipefail

hit=${1:-}
read -r -a browsers <<< "${2:?browsers required}"
shift 2
extra=("$@")
debs="$HOME/.cache/ci-apt-debs"
fresh=false

verify() {
  for package in "${extra[@]}"; do
    dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q "install ok installed" || { echo "missing $package after install"; return 1; }
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
  sudo env "PATH=$PATH" timeout -k 15 "$seconds" npx playwright install-deps "${browsers[@]}" || return 1
  if [ "${#extra[@]}" -gt 0 ]; then
    sudo timeout -k 15 "$seconds" apt-get install -y --no-install-recommends "${extra[@]}"
  fi
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

if [ "$hit" = "true" ] && offline; then
  echo "Installed $(compgen -G "$debs/*.deb" | wc -l) cached packages without apt"
else
  if [ "$hit" = "true" ]; then echo "::warning::Cached packages did not install; falling back to apt"; fi
  online
fi
echo "fresh=$fresh" >> "$GITHUB_OUTPUT"
