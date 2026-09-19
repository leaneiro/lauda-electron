#!/bin/bash
# Runs after the .deb installs Lauda into /opt/Lauda.

# The command line entry point, as electron-builder's own script makes it.
ln -sf '/opt/Lauda/lauda' '/usr/bin/lauda'

# Chromium's sandbox falls back to this helper where user namespaces are
# not available; it only works owned by root with the setuid bit.
chmod 4755 '/opt/Lauda/chrome-sandbox' || true

# Ubuntu 24.04 and later let only programs with an AppArmor profile create
# the user namespaces Chromium's sandbox needs, and ship profiles for
# well-known apps only. Without one Lauda would not start, so it brings its
# own, tied to where this package installs it.
if [ -d /etc/apparmor.d ] && [ -e /etc/apparmor.d/abi/4.0 ] && command -v apparmor_parser >/dev/null 2>&1; then
  cat > /etc/apparmor.d/lauda <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile lauda /opt/Lauda/lauda flags=(unconfined) {
  userns,

  include if exists <local/lauda>
}
PROFILE
  apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/lauda || true
fi

update-mime-database /usr/share/mime >/dev/null 2>&1 || true
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
