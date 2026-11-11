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
  --firmware-chroot false --firmware-binary false \
  --bootappend-live "boot=live components quiet splash loglevel=0 systemd.show_status=false rd.udev.log_level=0 vt.global_cursor_default=0 live-config.hostname=dani-os"

# ---- DANI boot menu: our own 640x480 splash instead of Debian's hard hat ----
# (the whole old menu picture, hat + text, is built from bootloaders/splash.svg; the live-build menu itself only uses the lower half)
mkdir -p config/bootloaders
cp -r /usr/share/live/build/bootloaders/. config/bootloaders/
rm -f config/bootloaders/splash.svg
cp "$ROOT/Shared/branding/boot-splash.png" config/bootloaders/splash.png
sed -i 's/^title-text:.*/title-text: ""/' config/bootloaders/grub-pc/live-theme/theme.txt

# IMPORTANT: an iso-hybrid image uses ISOLINUX for legacy BIOS boot.
# Debian's default ISOLINUX timeout is 0, which waits forever for Enter.
# Set a 5-second automatic boot while keeping the DANI splash/menu visible.
ISOLINUX_CFG=config/bootloaders/isolinux/isolinux.cfg
if [ -f "$ISOLINUX_CFG" ]; then
  if grep -qE '^[[:space:]]*timeout[[:space:]]+' "$ISOLINUX_CFG"; then
    sed -i -E 's/^[[:space:]]*timeout[[:space:]]+.*/timeout 50/' "$ISOLINUX_CFG"
  else
    printf '\\nprompt 0\\ntimeout 50\\n' >> "$ISOLINUX_CFG"
  fi
  if grep -qE '^[[:space:]]*prompt[[:space:]]+' "$ISOLINUX_CFG"; then
    sed -i -E 's/^[[:space:]]*prompt[[:space:]]+.*/prompt 0/' "$ISOLINUX_CFG"
  else
    sed -i '1i prompt 0' "$ISOLINUX_CFG"
  fi
fi

# GRUB (BIOS and UEFI): automatic 5-second start with the DANI logo.
for GRUB_CFG in config/bootloaders/grub-pc/grub.cfg config/bootloaders/grub-efi/grub.cfg; do
  if [ -f "$GRUB_CFG" ]; then
    if grep -qE '^[[:space:]]*set timeout=' "$GRUB_CFG"; then
      sed -i -E 's/^[[:space:]]*set timeout=.*/set timeout=5/' "$GRUB_CFG"
    else
      sed -i '1i set timeout=5' "$GRUB_CFG"
    fi
    if grep -qE '^[[:space:]]*set default=' "$GRUB_CFG"; then
      sed -i -E 's/^[[:space:]]*set default=.*/set default=0/' "$GRUB_CFG"
    fi
  fi
done

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
xserver-xorg-core xinit xserver-xorg-video-vmware xserver-xorg-video-fbdev xserver-xorg-video-vesa xserver-xorg-input-libinput
libpam-systemd dbus seatd fonts-noto-core fonts-noto-ui-core fonts-noto-color-emoji fonts-dejavu-core ca-certificates
nodejs npm python3 openssl
grub-efi-amd64 grub-efi-amd64-signed shim-signed grub-pc-bin efibootmgr eject gdisk dosfstools e2fsprogs squashfs-tools util-linux
pipewire pipewire-pulse wireplumber plymouth
bluez rfkill libspa-0.2-bluetooth wlr-randr brightnessctl tzdata
# Do not install the legacy Broadcom STA firmware installer: it can fail in chroot builds and is not needed for VMware/VirtualBox.
firmware-b43-installer-
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
# Starts the DANI desktop. Tries several graphics set-ups; if the desktop window never appears, shows WHY on screen.
if [ -d /run/live/medium ]; then PAGE=Installer/installer.html; else PAGE=Computer-OS/shell/index.html; fi
export ELECTRON_OZONE_PLATFORM_HINT=wayland
# keyboard layouts chosen in Settings (written by the agent to /etc/default/keyboard); cage reads them from the environment
if [ -r /etc/default/keyboard ]; then . /etc/default/keyboard; [ -n "$XKBLAYOUT" ] && export XKB_DEFAULT_LAYOUT="$XKBLAYOUT" XKB_DEFAULT_OPTIONS="$XKBOPTIONS"; fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
ELECTRON=/opt/dani-os/Computer-OS/shell/node_modules/.bin/electron
LOG=/tmp/dani-session.log
rm -f /tmp/dani-ready "$LOG"
set +e
if [ ! -x "$ELECTRON" ]; then
  echo "DANI OS ERROR: Electron is missing. Check the ISO build dependency installation." | tee "$LOG"
else
  n=0
  while [ $n -lt 2 ]; do
    n=$((n+1))
    echo "=== attempt $n ===" >>"$LOG"
    if [ $n = 1 ]; then
      export LIBSEAT_BACKEND=logind WLR_RENDERER_ALLOW_SOFTWARE=1 WLR_NO_HARDWARE_CURSORS=1
    else
      export LIBSEAT_BACKEND=seatd WLR_RENDERER=pixman WLR_NO_HARDWARE_CURSORS=1
    fi
    cage -s -- "$ELECTRON" --no-sandbox --disable-gpu --ozone-platform=wayland --enable-unsafe-swiftshader /opt/dani-os/Computer-OS/shell/main.js --page="$PAGE" >>"$LOG" 2>&1 &
    pid=$!
    t=0
    while [ $t -lt 45 ] && [ ! -e /tmp/dani-ready ] && kill -0 $pid 2>/dev/null; do sleep 1; t=$((t+1)); done
    if [ -e /tmp/dani-ready ]; then wait $pid; exit 0; fi
    echo "--- attempt $n: no desktop window after ${t}s (cage alive: $(kill -0 $pid 2>/dev/null && echo yes || echo no)) ---" >>"$LOG"
    kill $pid 2>/dev/null; sleep 2; kill -9 $pid 2>/dev/null; pkill -u "$(id -u)" -f electron 2>/dev/null; sleep 1
  done
fi
clear
echo "DANI OS: the desktop did not start. Please send a photo of this screen."
echo "user=$(id -un) XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"
ls -l /dev/dri /run/seatd.sock 2>&1 | head -12
echo
tail -n 35 "$LOG"
sleep 600
exit 1
EOF
chmod +x config/includes.chroot/usr/local/bin/dani-session


cat > config/includes.chroot/etc/systemd/system/dani-shell.service <<'EOF'
[Unit]
Description=DANI OS desktop (kiosk session on tty1)
After=systemd-user-sessions.service live-config.service dbus.service
Conflicts=getty@tty1.service
StartLimitIntervalSec=120
StartLimitBurst=3
[Service]
User=dani
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYReset=yes
TTYVHangup=no
TTYVTDisallocate=no
UtmpIdentifier=tty1
UtmpMode=user
ExecStartPre=-+/usr/bin/plymouth quit
ExecStart=/usr/local/bin/dani-session
Restart=on-failure
RestartSec=5
[Install]
WantedBy=graphical.target
EOF

# boot splash theme (Plymouth): DANI OS logo, white/red
T=config/includes.chroot/usr/share/plymouth/themes/dani
mkdir -p "$T"
cp "$ROOT/Shared/branding/plymouth/dani.plymouth" "$ROOT/Shared/branding/plymouth/dani.script" "$ROOT/Shared/branding/plymouth/bar.png" "$ROOT/Shared/branding/plymouth/bg.png" "$T/"
cp "$ROOT/Shared/branding/logo.png" "$T/logo.png"

# self-diagnosis: 70 s after boot, if the desktop window never appeared, print what is going on straight onto the screen (root, tty1)
echo "${GITHUB_RUN_NUMBER:-dev}" > config/includes.chroot/etc/dani-build
cat > config/includes.chroot/usr/local/bin/dani-diag <<'EOF'
#!/bin/sh
sleep 70
[ -e /tmp/dani-ready ] && exit 0
OUT=/tmp/dani-diag.txt
{
  echo "=============== DANI OS DIAGNOSTICS (build $(cat /etc/dani-build 2>/dev/null)) ==============="
  echo "The desktop window did not appear. Please photograph this whole screen."
  echo "--- dani-shell status"; systemctl status dani-shell --no-pager -l 2>&1 | tail -n 10 | cut -c1-170
  echo "--- processes"; ps -eo user,pid,etime,args 2>/dev/null | grep -E "dani-session|cage|electron|seatd" | grep -v grep | cut -c1-150 | head -n 8
  echo "--- /dev/dri"; ls -l /dev/dri 2>&1 | head -n 6
  echo "--- sessions"; loginctl list-sessions --no-pager 2>&1 | head -n 5
  echo "--- session log"; tail -n 22 /tmp/dani-session.log 2>&1 | cut -c1-170
  echo "--- journal"; journalctl -u dani-shell -b --no-pager 2>&1 | tail -n 10 | cut -c1-170
} > "$OUT" 2>&1
# the compositor owns the screen (graphics mode) and hides text: stop it so the text console comes back, then print
plymouth quit 2>/dev/null
systemctl stop dani-shell.service 2>/dev/null
pkill -f cage 2>/dev/null; pkill -f electron 2>/dev/null
sleep 2
chvt 2 2>/dev/null; sleep 1; chvt 1 2>/dev/null
{ printf '\033c'; cat "$OUT"; } > /dev/tty1 2>&1
EOF
chmod +x config/includes.chroot/usr/local/bin/dani-diag
cat > config/includes.chroot/etc/systemd/system/dani-diag.service <<'EOF'
[Unit]
Description=DANI OS startup self-diagnosis
After=dani-shell.service
[Service]
Type=simple
ExecStart=/usr/local/bin/dani-diag
[Install]
WantedBy=multi-user.target
EOF

# hook: install Electron with retries (GitHub/Electron downloads can occasionally return HTTP 504)
cat > config/hooks/live/0100-dani.hook.chroot <<'EOF'
#!/bin/sh
set -eu
cd /opt/dani-os/Computer-OS/shell
attempt=1
until npm install --omit=dev --no-audit --no-fund electron; do
  if [ "$attempt" -ge 4 ]; then
    echo "DANI OS ERROR: Electron installation failed after $attempt attempts."
    exit 1
  fi
  echo "Electron download failed; retrying ($attempt/3) in 15 seconds..."
  attempt=$((attempt + 1))
  sleep 15
done
# the DANI user is created here (live-config never created "dani", which is why the desktop service failed with 217/USER)
G=""; for g in audio video render input netdev plugdev sudo; do getent group $g >/dev/null && G="$G,$g"; done
mkdir -p /etc/skel/Pictures /etc/skel/Videos /etc/skel/Music /etc/skel/Downloads /etc/skel/Documents /etc/skel/Desktop
useradd -m -u 1500 -s /bin/bash -G "${G#,}" -c DANI dani
passwd -d dani
plymouth-set-default-theme dani || echo "DANI: plymouth theme not set"
update-initramfs -u -k all
systemctl enable dani-diag.service dani-shell.service dani-agent.service dani-pairing.service dani-installer-backend.service NetworkManager.service
systemctl enable bluetooth.service 2>/dev/null || true
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
