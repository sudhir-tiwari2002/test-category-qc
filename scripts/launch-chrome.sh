#!/usr/bin/env bash
# Launch Chrome with --remote-debugging-port against a SEPARATE user-data-dir,
# because Chrome 136+ silently drops the debug port when used with the default
# user-data-dir. See https://developer.chrome.com/blog/remote-debugging-port
#
# This launcher copies your real Chrome user-data-dir (which contains ALL your
# profiles + their cookies and logins) into a dedicated QC user-data-dir on
# first run, then launches Chrome against the copy with the profile you chose
# (via --profile-directory). To switch the active profile later you just pass
# a different PROFILE_DIR — no recopy needed.
#
# Usage:
#   PROFILE_DIR=Default ./scripts/launch-chrome.sh         # use "Default" profile
#   PROFILE_DIR="Profile 1" ./scripts/launch-chrome.sh     # use "Profile 1"
#   PORT=9444 PROFILE_DIR="Profile 2" ./scripts/launch-chrome.sh
#   FRESH=1 ./scripts/launch-chrome.sh                     # empty profile, sign in once
#   RESET=1 ./scripts/launch-chrome.sh                     # delete QC profile + re-copy
#
# Tip: run `node scripts/list-profiles.cjs` to see all profiles by name.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${PORT:-9333}"
QC_PROFILE="${QC_PROFILE:-$HOME/chrome-qc-profile}"
PROFILE_DIR="${PROFILE_DIR:-Default}"
FRESH="${FRESH:-0}"
RESET="${RESET:-0}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m⚠\033[0m %s\n" "$*"; }
err()  { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }

OS="$(uname -s)"
case "$OS" in
  Darwin)
    CHROME_APP="/Applications/Google Chrome.app"
    SRC_USER_DATA="$HOME/Library/Application Support/Google/Chrome"
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
    SRC_USER_DATA="$HOME/.config/google-chrome"
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

if [ "$RESET" = "1" ] && [ -d "$QC_PROFILE" ]; then
  warn "RESET=1 — removing $QC_PROFILE"
  rm -rf "$QC_PROFILE"
fi

if [ ! -d "$QC_PROFILE" ]; then
  if [ "$FRESH" = "1" ]; then
    bold "2/5  Creating empty QC profile at $QC_PROFILE (FRESH=1)..."
    mkdir -p "$QC_PROFILE"
    warn "Profile is empty — you will need to sign in to PW admin once after Chrome opens."
  else
    bold "2/5  Copying Chrome user-data-dir into $QC_PROFILE (first-time setup)..."
    if [ ! -d "$SRC_USER_DATA" ]; then
      err "Chrome user-data-dir not found at: $SRC_USER_DATA"
      err "Have you launched Chrome at least once on this machine?"
      err "(Or run with FRESH=1 and sign in once after Chrome opens.)"
      exit 1
    fi
    mkdir -p "$QC_PROFILE"
    cp -R "$SRC_USER_DATA/." "$QC_PROFILE/" 2>/dev/null || true
    ok "Profile copied (~$(du -sh "$QC_PROFILE" 2>/dev/null | cut -f1))."
  fi
else
  ok "2/5  Reusing existing QC profile at $QC_PROFILE"
fi

# Validate the requested profile directory exists in the QC copy.
# (Skip the check when FRESH=1 — Chrome will auto-create "Default".)
if [ "$FRESH" != "1" ] && [ ! -d "$QC_PROFILE/$PROFILE_DIR" ]; then
  err "Profile directory \"$PROFILE_DIR\" not found inside $QC_PROFILE."
  if [ -f "$PROJECT_ROOT/scripts/list-profiles.cjs" ] && command -v node >/dev/null 2>&1; then
    echo "Available profiles in your real Chrome user-data-dir:" >&2
    node "$PROJECT_ROOT/scripts/list-profiles.cjs" 2>/dev/null \
      | awk -F'\t' '{ printf "  - %s  (display name: %s)\n", $1, $2 }' >&2
    echo >&2
    echo "If the profile you want isn't listed above, run with RESET=1 to re-copy" >&2
    echo "from your real Chrome user-data-dir (which may have new profiles)." >&2
  fi
  exit 1
fi

bold "3/5  Launching Chrome on port $PORT (profile: $PROFILE_DIR)..."
LAUNCH_ARGS=(
  --remote-debugging-port="$PORT"
  --user-data-dir="$QC_PROFILE"
  --profile-directory="$PROFILE_DIR"
  --no-first-run
  --no-default-browser-check
)
case "$OS" in
  Darwin) "${LAUNCH_CMD[@]}" "${LAUNCH_ARGS[@]}" ;;
  Linux)  nohup "${LAUNCH_CMD[@]}" "${LAUNCH_ARGS[@]}" >/dev/null 2>&1 & ;;
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
ok "Ready! In the Chrome window that just opened:"
echo "    1. (First launch only) Sign in to PW admin if you're not already signed in."
echo "    2. Navigate to the test category and click Preview."
echo "    3. Run:  qc run    (or:  npm run qc)"
