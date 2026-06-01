#!/usr/bin/env bash
# Server install for agents-office — run via curl:
#   curl -fsSL https://raw.githubusercontent.com/lessch4os/agents-office/main/scripts/install-server.sh | bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

step()  { printf "${CYAN}==>${NC} %s\n" "$*" >&2; }
ok()    { printf "${GREEN}  ✓${NC} %s\n" "$*" >&2; }
fail()  { printf "${RED}  ✗${NC} %s\n" "$*" >&2; exit 1; }

SERVER_HOSTNAME="${SERVER_HOSTNAME:-agents-office.lessch4os.com}"
VERSION="${VERSION:-0.1.17}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
CFG_DIR="$HOME/.agents-office"

step "agents-office server installer v${VERSION}"
echo ""

# ── Detect platform ──────────────────────────────────────────────
ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

case "$ARCH" in
  x86_64|amd64) BARCH="x64" ;;
  aarch64|arm64) BARCH="arm64" ;;
  *) echo "unsupported arch: $ARCH"; BARCH="$ARCH" ;;
esac

PLATFORM="${OS}-${BARCH}"
BINARY_NAME="agents-office-${PLATFORM}"
BINARY_URL="https://github.com/lessch4os/agents-office/releases/download/v${VERSION}/${BINARY_NAME}"

step "platform: ${PLATFORM}"

# ── Download prebuilt binary ─────────────────────────────────────
step "downloading ${BINARY_NAME} v${VERSION}..."
mkdir -p "$INSTALL_DIR"

if command -v curl &>/dev/null; then
  curl -fsSL "$BINARY_URL" -o "$INSTALL_DIR/agents-office" || {
    ok "binary download failed — falling back to npm+bun"
    USE_BUN=1
  }
elif command -v wget &>/dev/null; then
  wget -q "$BINARY_URL" -O "$INSTALL_DIR/agents-office" || {
    ok "binary download failed — falling back to npm+bun"
    USE_BUN=1
  }
else
  ok "neither curl nor wget found — falling back to npm+bun"
  USE_BUN=1
fi

if [ -z "${USE_BUN:-}" ]; then
  chmod +x "$INSTALL_DIR/agents-office"
  if ! "$INSTALL_DIR/agents-office" --version &>/dev/null; then
    ok "downloaded binary failed to execute — falling back to npm+bun"
    USE_BUN=1
    rm -f "$INSTALL_DIR/agents-office"
  fi
fi

# ── Fallback: install via npm + bun ─────────────────────────────
if [ -n "${USE_BUN:-}" ]; then
  step "fallback: installing via npm + bun..."

  if ! command -v bun &>/dev/null; then
    step "bun not found — installing..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if ! command -v bun &>/dev/null; then
      fail "bun install failed — install manually: curl -fsSL https://bun.sh/install | bash"
    fi
    ok "bun $(bun --version) installed"
  else
    ok "bun $(bun --version) found"
  fi

  npm install -g @lessch4os/agents-office 2>/dev/null || bunx --yes @lessch4os/agents-office --version 2>/dev/null || {
    fail "npm install failed — try: npm install -g @lessch4os/agents-office"
  }
  ok "package installed via npm"
  INSTALL_METHOD="npm"
else
  ok "binary installed: $(agents-office --version)"
  INSTALL_METHOD="binary"
fi

# ── Setup config directory ───────────────────────────────────────
mkdir -p "$CFG_DIR"

# ── Prompt for password ──────────────────────────────────────────
if [ ! -f "$CFG_DIR/config.json" ]; then
  echo ""
  read -rp "Enter server password (leave empty for auto-generate): " PASSWORD
  if [ -z "$PASSWORD" ]; then
    PASSWORD=$(openssl rand -hex 16)
    echo "  generated password: $PASSWORD"
  fi
  cat > "$CFG_DIR/config.json" <<EOF
{
  "server_url": "wss://$SERVER_HOSTNAME/hook",
  "password": "$PASSWORD"
}
EOF
  ok "config written to $CFG_DIR/config.json"
fi

PASSWORD=$(grep '"password"' "$CFG_DIR/config.json" | sed 's/.*"password": "\(.*\)".*/\1/')

# ── Create systemd service ──────────────────────────────────────
SERVICE_NAME="agents-office"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

step "setting up systemd service..."

if [ "$INSTALL_METHOD" = "binary" ]; then
  DAEMON_CMD="$INSTALL_DIR/agents-office --port 8080 --password $PASSWORD"
else
  BUN_PATH="$(command -v bun)"
  DAEMON_CMD="$BUN_PATH x @lessch4os/agents-office --port 8080 --password $PASSWORD"
fi

sudo tee "$SERVICE_FILE" >/dev/null <<SERVICEEOF
[Unit]
Description=agents-office daemon
After=network.target

[Service]
Type=simple
ExecStart=$DAEMON_CMD
Restart=on-failure
RestartSec=5
User=$(whoami)
Environment=HOME=$HOME
Environment=AGENTS_OFFICE_PASSWORD=$PASSWORD

[Install]
WantedBy=multi-user.target
SERVICEEOF
ok "service file created"

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
ok "service started"

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo "${GREEN}================================================${NC}"
echo "${GREEN}  agents-office is running!${NC}"
echo "${GREEN}================================================${NC}"
echo ""
echo "  URL:      http://$(curl -s ifconfig.me 2>/dev/null || echo "localhost"):8080"
echo "  Password: $PASSWORD"
echo ""
echo "  Method:   $INSTALL_METHOD"
echo "  Binary:   agents-office"
echo ""
echo "  Manage:   sudo systemctl status agents-office"
echo "  Logs:     journalctl -u agents-office -f"
echo "  Upgrade:  $([ "$INSTALL_METHOD" = "binary" ] && echo "download new binary from GitHub Releases" || echo "npm update -g @lessch4os/agents-office && sudo systemctl restart agents-office")"
echo ""
echo "  Client machines:"
echo "    agents-office-forwarder \\"
echo "      --server wss://your-domain/hook --password $PASSWORD"
echo ""
