#!/usr/bin/env bash
# Builds the DANI OS live/installer ISO with Debian live-build (Debian 13 "trixie" base).
# Run on a Debian/Ubuntu host as root. It writes only inside ./work and ../ISO — it never touches your disks.
#   sudo ./build-iso.sh            -> ../ISO/dani-os-<version>-amd64.iso
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/Computer-OS/shell/package.json').version" 2>/dev/null || echo 0.1.0)"
WORK="$ROOT/Build-Scripts/work"

[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
for t in lb debootstrap xorriso mksquashfs; do command -v "$t" >/dev/null || { echo "missing tool: $t  (apt install live-build debootstrap xorriso squashfs-tools)"; exit 1; }; done

rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

lb config \
  --distribution trixie --architectures amd64 \
  --archive-areas "main contrib non-free-firmware" \
  --binary-images iso-hybrid --bootloaders "grub-pc,grub-efi" \
  --iso-application "DANI OS" --iso-volume "DANI-OS" --iso-publisher "DANI" \
  --debian-installer none --apt-recommends false \
  --bootappend-live "boot=live components quiet splash live-config.username=dani live-config.user-fullname=DANI live-config.hostname=dani-os live-config.user-default-groups=audio,video,render,input,netdev,plugdev,sudo"

# ---- DANI boot menu: our own 640x480 splash instead of Debian's hard hat ----
# (the whole old menu picture, hat + text, is built from bootloaders/splash.svg; the live-build menu itself only uses the lower half)
mkdir -p config/bootloaders
cp -r /usr/share/live/build/bootloaders/. config/bootloaders/
rm -f config/bootloaders/splash.svg
cp "$ROOT/Shared/branding/boot-splash.png" config/bootloaders/splash.png
sed -i 's/^title-text:.*/title-text: ""/' config/bootloaders/grub-pc/live-theme/theme.txt

# live-build regenerates the menu picture (800x600 hard hat) later in the build, so put ours in AFTER everything else (binary hook)
cp "$ROOT/Shared/branding/boot-splash.png" config/dani-splash.png
mkdir -p config/hooks/live
cat > config/hooks/live/0900-dani-splash.hook.binary <<'EOF'
#!/bin/sh
set -e
echo "DANI splash hook: cwd=$(pwd)"
find . -name 'splash.png' 2>/dev/null | while read -r f; do
  cp -f ../config/dani-splash.png "$f" && echo "DANI splash installed: $f"
done
true
EOF
chmod +x config/hooks/live/0900-dani-splash.hook.binary

# ---- packages: minimal Wayland kiosk, NO traditional Linux desktop environment ----
mkdir -p config/package-lists
cat > config/package-lists/dani.list.chroot <<'EOF'
linux-image-amd64 live-boot systemd-sysv sudo network-manager
cage xwayland libgbm1 libgtk-3-0t64 libnss3 libxss1 libasound2t64 libxkbcommon0 libdrm2 libgl1-mesa-dri libegl1 mesa-vulkan-drivers
libpam-systemd dbus seatd fonts-noto-core fonts-noto-ui-core fonts-noto-color-emoji fonts-dejavu-core ca-certificates
nodejs npm python3 openssl
grub-efi-amd64 grub-efi-amd64-signed shim-signed efibootmgr gdisk dosfstools e2fsprogs squashfs-tools util-linux
pipewire pipewire-pulse wireplumber
EOF

# ---- files copied into the image ----
D=config/includes.chroot/opt/dani-os
mkdir -p "$D" config/includes.chroot/etc/systemd/system/getty@tty1.service.d config/includes.chroot/etc/systemd/system config/hooks/live
cp -r "$ROOT/Computer-OS" "$D/Computer-OS"
cp -r "$ROOT/Shared" "$D/Shared"
cp -r "$ROOT/Installer" "$D/Installer"
rm -rf "$D/Shared/data"     # never ship account data

# autologin of the live user is configured by live-config (username=dani)
cat > config/includes.chroot/etc/systemd/system/dani-pairing.service <<'EOF'
[Unit]
Description=DANI OS pairing/account server (phone <-> computer, LAN)
[Service]
Environment=HOST=0.0.0.0
Environment=DANI_DATA=/var/lib/dani-os
ExecStart=/usr/bin/node /opt/dani-os/Shared/pairing-server.js
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
cat > config/includes.chroot/etc/systemd/system/dani-agent.service <<'EOF'
[Unit]
Description=DANI OS system agent
[Service]
Environment=DANI_REAL=1
ExecStart=/usr/bin/node /opt/dani-os/Computer-OS/agent/agent.js
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
cat > config/includes.chroot/etc/systemd/system/dani-installer-backend.service <<'EOF'
[Unit]
Description=DANI OS installer backend (live session only)
ConditionPathExists=/run/live/medium
[Service]
ExecStart=/usr/bin/python3 /opt/dani-os/Installer/dani-install-server.py
Environment=DANI_INSTALL_EXECUTE=1
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF

# autostart: a systemd service starts the kiosk compositor directly on tty1 as the DANI user (PAMName=login gives it a real
# logind session WITHOUT a password check), so there is no getty/login autologin that can fail with "Authentication failure".
# live session -> installer, installed system -> desktop shell.
mkdir -p config/includes.chroot/usr/local/bin
cat > config/includes.chroot/usr/local/bin/dani-session <<'EOF'
#!/bin/sh
if [ -d /run/live/medium ]; then PAGE=Installer/installer.html; else PAGE=Computer-OS/shell/index.html; fi
export ELECTRON_OZONE_PLATFORM_HINT=wayland
exec cage -s -- /opt/dani-os/Computer-OS/shell/node_modules/.bin/electron --no-sandbox /opt/dani-os/Computer-OS/shell/main.js --page="$PAGE"
EOF
chmod +x config/includes.chroot/usr/local/bin/dani-session
cat > config/includes.chroot/etc/systemd/system/dani-shell.service <<'EOF'
[Unit]
Description=DANI OS desktop (kiosk session on tty1)
After=systemd-user-sessions.service live-config.service dbus.service getty@tty1.service
Conflicts=getty@tty1.service
[Service]
User=dani
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
UtmpIdentifier=tty1
UtmpMode=user
ExecStart=/usr/local/bin/dani-session
Restart=always
RestartSec=2
[Install]
WantedBy=graphical.target
EOF

# hook: install Electron (needs network during the build), create the live user, enable services
cat > config/hooks/live/0100-dani.hook.chroot <<'EOF'
#!/bin/sh
set -e
cd /opt/dani-os/Computer-OS/shell && npm install --omit=dev --no-audit --no-fund electron
systemctl enable dani-shell.service dani-agent.service dani-pairing.service dani-installer-backend.service NetworkManager.service
systemctl set-default graphical.target
systemctl mask getty@tty1.service
EOF
chmod +x config/hooks/live/0100-dani.hook.chroot

echo "== building ISO (this takes a while and downloads ~1-2 GB) =="
lb build

ISO="$(ls -1 live-image-*.iso | head -n1)"
mkdir -p "$ROOT/ISO"
mv "$ISO" "$ROOT/ISO/dani-os-$VERSION-amd64.iso"
( cd "$ROOT/ISO" && sha256sum "dani-os-$VERSION-amd64.iso" > "dani-os-$VERSION-amd64.iso.sha256" )
echo "Done: $ROOT/ISO/dani-os-$VERSION-amd64.iso"
echo "Test it in a VM first:  $ROOT/Build-Scripts/test-iso-qemu.sh"
