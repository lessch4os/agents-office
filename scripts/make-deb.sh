#!/usr/bin/env bash
# Build a .deb package from a compiled agents-office binary
# Usage: bash scripts/make-deb.sh <binary-path> <version>
# Example: bash scripts/make-deb.sh daemon/agents-office-linux-x64 0.1.17
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <binary-path> <version>"
  echo "Example: $0 daemon/agents-office-linux-x64 0.1.17"
  exit 1
fi

BINARY="$1"
VERSION="$2"

if [ ! -f "$BINARY" ]; then
  echo "FAIL: binary not found at $BINARY"
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) DEB_ARCH="amd64" ;;
  aarch64|arm64) DEB_ARCH="arm64" ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac

PACKAGE="agents-office"
DEB_DIR="/tmp/agents-office-deb-$$"
DEB_FILE="${PACKAGE}_${VERSION}_${DEB_ARCH}.deb"

mkdir -p "$DEB_DIR/DEBIAN"
mkdir -p "$DEB_DIR/usr/local/bin"
mkdir -p "$DEB_DIR/lib/systemd/system"

# Copy binary
cp "$BINARY" "$DEB_DIR/usr/local/bin/agents-office"
chmod 755 "$DEB_DIR/usr/local/bin/agents-office"

# Create systemd service file
cat > "$DEB_DIR/lib/systemd/system/agents-office.service" <<SERVICEEOF
[Unit]
Description=agents-office daemon
Documentation=https://agents-office.lessch4os.com
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/agents-office --port 8080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Create control file
cat > "$DEB_DIR/DEBIAN/control" <<CTRLEOF
Package: $PACKAGE
Version: $VERSION
Section: utils
Priority: optional
Architecture: $DEB_ARCH
Maintainer: agents-office <dev@agents-office.lessch4os.com>
Description: Real-time office dashboard for AI coding agents
 Visualize Claude Code, OpenCode, and Antigravity sessions
 as animated agents in a web-based office dashboard.
Homepage: https://agents-office.lessch4os.com
CTRLEOF

# Create postinst script
cat > "$DEB_DIR/DEBIAN/postinst" <<POSTINST
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable agents-office 2>/dev/null || true
  systemctl start agents-office 2>/dev/null || true
fi
POSTINST
chmod 755 "$DEB_DIR/DEBIAN/postinst"

# Create prerm script
cat > "$DEB_DIR/DEBIAN/prerm" <<PRERM
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop agents-office 2>/dev/null || true
  systemctl disable agents-office 2>/dev/null || true
fi
PRERM
chmod 755 "$DEB_DIR/DEBIAN/prerm"

# Build the .deb
dpkg-deb --build "$DEB_DIR" "$DEB_FILE" >/dev/null
rm -rf "$DEB_DIR"

echo "$DEB_FILE"
