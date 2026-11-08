#!/usr/bin/env bash
# Boots the ISO in QEMU with a throw-away virtual disk. Your real disks are never exposed to the VM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ISO="$(ls -1 "$ROOT"/ISO/*.iso 2>/dev/null | head -n1)" || true
[ -n "${ISO:-}" ] || { echo "No ISO in $ROOT/ISO — run build-iso.sh first."; exit 1; }
DISK="$(mktemp -d)/virtual.qcow2"
qemu-img create -f qcow2 "$DISK" 32G
OVMF=/usr/share/OVMF/OVMF_CODE.fd
exec qemu-system-x86_64 -enable-kvm -m 4G -smp 2 -cpu host \
  -drive if=pflash,format=raw,readonly=on,file="$OVMF" \
  -drive file="$DISK",format=qcow2 -cdrom "$ISO" -boot d -vga virtio -display gtk \
  -nic user,hostfwd=tcp::7799-:7799
