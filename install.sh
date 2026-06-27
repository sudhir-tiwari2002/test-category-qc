#!/usr/bin/env bash
# install.sh — one-shot installer for a brand-new device.
#
# What it does:
#   1. Checks Node.js (>= 18.18) and Chrome are installed
#   2. Runs `npm install`
#   3. Creates .env from .env.example
#   4. Optionally symlinks ./bin/qc into /usr/local/bin so `qc` works anywhere
#
# Run it from inside the cloned project:
#   git clone <repo-url>
#   cd test-category-qc
#   ./install.sh
#
# Or one-liner from anywhere (after a git clone):
#   bash <(curl -fsSL <raw-url>/install.sh)
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[33m⚠\033[0m %s\n" "$*"; }
err()  { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }

bold "▶ test-category-qc installer"
echo "  project root: $PROJECT_ROOT"
echo

# 1) Node check
if ! command -v node >/dev/null 2>&1; then
  err "Node.js not installed."
  cat <<'EOF'
  Install Node.js 18.18+ then re-run ./install.sh
    macOS:       brew install node     (or download from https://nodejs.org)
    Linux:       use nvm  →  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
                              nvm install --lts
EOF
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then
  err "Node $(node -v) is too old. Need >= 18.18."
  exit 1
fi
ok "Node $(node -v)"

# 2) Chrome check (best-effort; Linux paths vary)
case "$(uname -s)" in
  Darwin)
    if [ -d "/Applications/Google Chrome.app" ]; then ok "Chrome installed"
    else warn "Google Chrome not found at /Applications/Google Chrome.app — install from https://www.google.com/chrome/"
    fi ;;
  Linux)
    if command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1; then ok "Chrome/Chromium installed"
    else warn "google-chrome / chromium not found in PATH"
    fi ;;
  *) warn "Unrecognized OS ($(uname -s)) — skipping Chrome check" ;;
esac

# 3) npm install
bold "▶ Installing Node dependencies (this may take a minute)…"
(cd "$PROJECT_ROOT" && npm install --no-audit --no-fund)
touch "$PROJECT_ROOT/node_modules/.qc-installed"
ok "Dependencies installed."

# 4) .env bootstrap
if [ ! -f "$PROJECT_ROOT/.env" ] && [ -f "$PROJECT_ROOT/.env.example" ]; then
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
  ok ".env created from .env.example"
fi

# 5) Make scripts executable
chmod +x "$PROJECT_ROOT/bin/qc" "$PROJECT_ROOT/scripts/launch-chrome.sh" 2>/dev/null || true

# 6) Offer to install globally
echo
read -r -p "Install \`qc\` as a global command in /usr/local/bin? [y/N] " yn
case "$yn" in
  [yY]*) "$PROJECT_ROOT/bin/qc" install-global ;;
  *)     warn "Skipped global install. You can still use ./bin/qc from this folder." ;;
esac

echo
ok "Install complete."
echo
bold "Next steps:"
echo "  1)  qc all                 # launches Chrome → wait → QC → opens report"
echo "      OR"
echo "  1)  qc launch-chrome       # opens Chrome on the QC profile"
echo "  2)  open the test category in preview mode, then:"
echo "  3)  qc run                 # runs the QC"
echo "  4)  qc report              # opens the latest HTML report"
echo
echo "If anything looks off:  ${C_BOLD:-}qc doctor${C_RST:-}"
