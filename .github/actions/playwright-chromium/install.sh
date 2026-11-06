#!/usr/bin/env bash
# Installs Playwright's Chromium and the Ubuntu packages it needs. Used by action.yml next to this file.
#
# Why not just `npx playwright install --with-deps chromium`: the runner image already has Chromium's
# libraries, so --with-deps only adds nine font packages (about 22 MB) from the Ubuntu mirror. On
# 2026-11-06 that mirror served them to some runners at 26-36 kB/s, the usual 15 s step took 10-14
# minutes, and the browser jobs ran out of time. So:
#   1. the font packages' .deb files come from the Actions cache when it has them, installed with
#      dpkg, which never touches the network (apt-get, even given the local files, fetched the same
#      versions from the mirror again);
#   2. Playwright's own check (install-deps --dry-run) decides whether anything is still missing;
#   3. only then is the mirror used: a first try cut off after a minute (a healthy mirror needs
#      1-8 s), then a second, longer one that skips the Azure mirror that stalled;
#   4. the browser itself comes from Playwright's CDN (fast; cut off and tried again the same way).
set -euo pipefail

debs="$HOME/.cache/playwright-debs"
node="$(command -v node)"
cli="$PWD/node_modules/playwright/cli.js"
apt_tries=(1m 3m)  # per try of the mirror
browser_try=2m     # the CDN usually needs under 15 s for the browser and its headless shell
started=$SECONDS
from="already on the runner"

if compgen -G "$debs/*.deb" >/dev/null; then
  echo "::group::Install $(ls "$debs"/*.deb | wc -l) system packages from the Actions cache"
  # their own dependencies are on the runner image already (apt downloaded only these), and dpkg
  # configures the ones that depend on each other after unpacking them all
  if sudo timeout -k 10s 2m dpkg -i "$debs"/*.deb; then from="Actions cache"
  else echo "::warning title=Cached packages::Installing the cached system packages failed; the check below decides what is missing."; fi
  echo "::endgroup::"
fi

echo "::group::Check Chromium's system packages"
if "$node" "$cli" install-deps --dry-run chromium; then
  echo "::endgroup::"
else
  echo "::endgroup::"
  from="Ubuntu mirror"
  marker="$(mktemp)"
  # keep what apt downloads, so the cache can be filled from it below
  echo 'APT::Keep-Downloaded-Packages "true";' | sudo tee /etc/apt/apt.conf.d/99-keep-playwright-debs >/dev/null
  done_apt=
  for try in 1 2; do
    limit="${apt_tries[$((try - 1))]}"
    echo "::group::Install the missing system packages from the Ubuntu mirror (try $try of 2, at most $limit)"
    # timeout runs as root so that, when it fires, it also stops apt-get and its downloads
    if sudo timeout -k 15s "$limit" "$node" "$cli" install-deps chromium; then done_apt=1; fi
    echo "::endgroup::"
    [ -n "$done_apt" ] && break
    echo "::warning title=Slow Ubuntu mirror::Installing Chromium's system packages failed or took over $limit (try $try of 2)."
    sudo dpkg --configure -a || true
    if [ "$try" = 1 ] && [ -f /etc/apt/apt-mirrors.txt ]; then
      echo "Mirrors: $(tr '\n' ' ' < /etc/apt/apt-mirrors.txt)"
      if grep -q 'azure\.archive\.ubuntu\.com' /etc/apt/apt-mirrors.txt \
        && grep -v 'azure\.archive\.ubuntu\.com' /etc/apt/apt-mirrors.txt | grep -q '^http'; then
        echo "Trying again without the Azure mirror."
        sudo sed -i '/azure\.archive\.ubuntu\.com/d' /etc/apt/apt-mirrors.txt
      fi
    fi
  done
  [ -n "$done_apt" ] || { echo "::error::Could not install Chromium's system packages."; exit 1; }
  mkdir -p "$debs"
  # -cnewer, not -newer: apt dates each downloaded file by the server's Last-Modified
  find /var/cache/apt/archives -maxdepth 1 -name '*.deb' -cnewer "$marker" -exec cp {} "$debs"/ \;
  echo "Kept $(find "$debs" -name '*.deb' | wc -l) .deb files for the Actions cache."
fi

done_browser=
for try in 1 2; do
  echo "::group::Download Chromium from Playwright's CDN (try $try of 2, at most $browser_try)"
  if timeout -k 15s "$browser_try" "$node" "$cli" install chromium; then done_browser=1; fi
  echo "::endgroup::"
  [ -n "$done_browser" ] && break
  echo "::warning title=Slow browser download::Downloading Chromium failed or took over $browser_try (try $try of 2)."
done
[ -n "$done_browser" ] || { echo "::error::Could not download Chromium."; exit 1; }

echo "Chromium ready in $((SECONDS - started)) s (system packages: $from)."
echo "debs=$(find "$debs" -name '*.deb' 2>/dev/null | wc -l)" >> "$GITHUB_OUTPUT"
