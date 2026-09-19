#!/bin/bash
# Runs after the .deb removes Lauda.
rm -f '/usr/bin/lauda'
if [ -e /etc/apparmor.d/lauda ]; then
  apparmor_parser --remove /etc/apparmor.d/lauda >/dev/null 2>&1 || true
  rm -f /etc/apparmor.d/lauda
fi
