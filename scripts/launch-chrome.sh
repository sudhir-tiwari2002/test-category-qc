#!/usr/bin/env bash
# Launch Chrome with --remote-debugging-port against a SEPARATE user-data-dir,
# because Chrome 136+ silently drops the debug port when used with the default
# profile directory. See https://developer.chrome.com/blog/remote-debugging-port
#
# On first run, copies Sakshi's default Chrome profile into the QC profile so
# all logins/cookies/bookmarks carry over. Subsequent runs reuse the copy.
#
# Usage:
#   ./scripts/launch-chrome.sh                       # default port 9333
#   PORT=9444 ./scripts/launch-chrome.sh             # override port
#   FRESH=1 ./scripts/launch-chrome.sh               # start with an empty profile (no copy)
#   RESET=1 ./scripts/launch-chrome.sh               # delete QC profile + re-copy
set -euo pipefail

PORT="${PORT:-9333}"
QC_PROFILE="${QC_PROFILE:-$HOME/chrome-qc-profile}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m⚠\033[0m %s\n" "$*"; }
err()  { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }

OS="$(uname -s)"
case "$OS" in
  Darwin)
    CHROME_APP="/Applications/Google Chrome.app"
    DEFAULT_PROFILE="$HOME/Library/Application Support/Google/Chrome"
    LAUNCH_CMD=( open -na "Google Chrome" --args )
    if [ ! -d "$CHROME_APP" ]; then
      err "Google Chrome.app not found at $CHROME_APP — install from https://www.google.com/chrome/"
      exit 1
    fi
    ;;
  Linux)
    if command -v google-chrome >/dev/null 2>&1; then CHROME_BIN="google-chrome"
    elif command -v google-chrome-stable >/dev/null 2>&1; then CHROME_BIN="google-chrome-stable"
    elif command -v chromium >/dev/null 2>&1; then CHROME_BIN="chromium"
    elif command -v chromium-browser >/dev/null 2>&1; then CHROME_BIN="chromium-browser"
    else err "No google-chrome / chromium binary found in PATH."; exit 1
    fi
    DEFAULT_PROFILE="$HOME/.config/google-chrome"
    LAUNCH_CMD=( "$CHROME_BIN" )
    ;;
  *)
    err "Unsupported OS: $OS"
    exit 1
    ;;
esac

bold "1/5  Quitting any running Chrome..."
case "$OS" in
  Darwin) pkill -9 -f "Google Chrome" 2>/dev/null || true ;;
  Linux)  pkill -9 -f "chrome" 2>/dev/null || true ;;
esac
sleep 2

if [ "${RESET:-0}" = "1" ] && [ -d "$QC_PROFILE" ]; then
  warn "RESET=1 — removing $QC_PROFILE"
  rm -rf "$QC_PROFILE"
fi

if [ ! -d "$QC_PROFILE" ]; then
  if [ "${FRESH:-0}" = "1" ]; then
    bold "2/5  Creating empty QC profile at $QC_PROFILE (FRESH=1)..."
    mkdir -p "$QC_PROFILE"
    warn "Profile is empty — you will need to sign in once after Chrome opens."
  else
    bold "2/5  Copying default Chrome profile into $QC_PROFILE (first-time setup)..."
    if [ ! -d "$DEFAULT_PROFILE" ]; then
      err "Default Chrome profile not found at: $DEFAULT_PROFILE"
      err "Try with FRESH=1 instead and sign in once."
      exit 1
    fi
    mkdir -p "$QC_PROFILE"
    cp -R "$DEFAULT_PROFILE/." "$QC_PROFILE/" 2>/dev/null || true
    ok "Profile copied (~$(du -sh "$QC_PROFILE" 2>/dev/null | cut -f1))."
  fi
else
  ok "2/5  Reusing existing QC profile at $QC_PROFILE"
fi

bold "3/5  Launching Chrome on port $PORT..."
case "$OS" in
  Darwin)
    "${LAUNCH_CMD[@]}" \
      --remote-debugging-port="$PORT" \
      --user-data-dir="$QC_PROFILE"
    ;;
  Linux)
    nohup "${LAUNCH_CMD[@]}" \
      --remote-debugging-port="$PORT" \
      --user-data-dir="$QC_PROFILE" \
      >/dev/null 2>&1 &
    ;;
esac

bold "4/5  Waiting for the debug port to come up..."
for i in $(seq 1 20); do
  if curl -sS -m 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    ok "Debug port $PORT is live."
    break
  fi
  if [ "$i" = "20" ]; then
    err "Port $PORT did not come up after 20s."
    err "Check:  ps -axo command | grep 'Google Chrome' | grep remote-debugging"
    err "        lsof -nP -iTCP:$PORT -sTCP:LISTEN"
    exit 1
  fi
  sleep 1
done

bold "5/5  Chrome info:"
curl -sS "http://127.0.0.1:${PORT}/json/version" | sed 's/,"/,\n  "/g' | head -10

echo
ok "Ready! Now in the Chrome window:"
echo "    1. Sign in if asked (only first time, only if FRESH=1)"
echo "    2. Open the test category in preview mode"
echo "    3. Run:  qc run    (or:  npm run qc)"
