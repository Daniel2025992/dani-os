#!/usr/bin/env python3
"""DANI OS installer backend (runs inside the live ISO, serves installer.html's API on 127.0.0.1:7790).

SAFETY
  * DRY-RUN BY DEFAULT: without DANI_INSTALL_EXECUTE=1 every step is only printed, nothing is touched.
  * Refuses to run on a non-live system unless DANI_ALLOW_NON_LIVE=1.
  * The target disk must be a whole disk, must not be the disk the live system booted from,
    and the request must repeat the exact path in "confirm".
  * Never uses a shell; the password is passed to openssl on stdin and only a SHA-512 crypt hash is stored.
"""
import base64, hashlib, json, os, re, subprocess, sys, shlex
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

EXECUTE = os.environ.get("DANI_INSTALL_EXECUTE") == "1"
LIVE = os.path.exists("/run/live/medium") or os.environ.get("DANI_ALLOW_NON_LIVE") == "1"
SQUASH = os.environ.get("DANI_SQUASHFS", "/run/live/medium/live/filesystem.squashfs")
TARGET = "/mnt/dani-target"
EDITIONS = {"Home": [], "Pro": ["git", "build-essential", "python3-pip", "nodejs", "npm"], "Gamer": ["steam-installer", "mesa-vulkan-drivers"]}


def lsblk():
    out = subprocess.run(["lsblk", "-J", "-b", "-d", "-o", "NAME,PATH,SIZE,MODEL,TYPE,RM"], capture_output=True, text=True).stdout
    return json.loads(out or '{"blockdevices":[]}')["blockdevices"]


def live_disk():
    try:
        src = subprocess.run(["findmnt", "-n", "-o", "SOURCE", "/run/live/medium"], capture_output=True, text=True).stdout.strip()
        if not src:
            return None
        parent = subprocess.run(["lsblk", "-n", "-o", "PKNAME", src], capture_output=True, text=True).stdout.strip()
        return "/dev/" + (parent or os.path.basename(src))
    except Exception:
        return None


def disks():
    ld = live_disk()
    return [{"path": d["path"], "size": f'{int(d["size"]) / 1e9:.0f} GB', "model": (d.get("model") or "").strip()}
            for d in lsblk() if d["type"] == "disk" and d["path"] != ld and not d["path"].startswith(("/dev/loop", "/dev/zram", "/dev/sr"))]


def part(disk, n):
    return f"{disk}p{n}" if re.search(r"\d$", disk) else f"{disk}{n}"


def validate(cfg):
    if not LIVE:
        raise ValueError("לא רץ בתוך ה-ISO החי (הגדר DANI_ALLOW_NON_LIVE=1 לבדיקות)")
    if cfg.get("disk") not in [d["path"] for d in disks()] or cfg.get("confirm") != cfg.get("disk"):
        raise ValueError("דיסק לא תקף או חסר אישור")
    if cfg.get("edition") not in EDITIONS:
        raise ValueError("מהדורה לא תקפה")
    if cfg.get("username") and not re.fullmatch(r"[a-z_][a-z0-9_-]{1,30}", cfg["username"]):
        raise ValueError("שם משתמש לא תקף")
    for k, rx in (("language", r"[a-z]{2}"), ("country", r"[A-Z]{2}"), ("keyboard", r"[a-z]{2}"), ("timezone", r"[A-Za-z_]+/[A-Za-z_/+-]+")):
        if not re.fullmatch(rx, cfg.get(k, "")):
            raise ValueError("ערך לא תקף: " + k)


def profile_json(cfg, u):
    """Lock-screen profile read by the DANI shell on first boot (PBKDF2-SHA256, 200k, same as WebCrypto). Hash only."""
    prof = {"name": cfg.get("username") or None, "avatar": "😀", "salt": None, "hash": None}
    if cfg.get("password"):
        salt = os.urandom(16)
        prof["salt"] = base64.b64encode(salt).decode()
        prof["hash"] = base64.b64encode(hashlib.pbkdf2_hmac("sha256", cfg["password"].encode(), salt, 200000, 32)).decode()
    return json.dumps(prof, ensure_ascii=False)


def plan(cfg):
    d = cfg["disk"]
    u = cfg.get("username") or "dani"          # no user given -> default account, real user is created at first boot
    p1, p2 = part(d, 1), part(d, 2)
    steps = [
        ("חלוקת דיסק", [["sgdisk", "--zap-all", d], ["sgdisk", "-n1:0:+512M", "-t1:ef00", "-n2:0:0", "-t2:8300", d]]),
        ("פורמט", [["mkfs.vfat", "-F32", p1], ["mkfs.ext4", "-F", "-L", "DANI-OS", p2]]),
        ("הרכבה", [["mkdir", "-p", TARGET], ["mount", p2, TARGET], ["mkdir", "-p", TARGET + "/boot/efi"], ["mount", p1, TARGET + "/boot/efi"]]),
        ("העתקת המערכת", [["unsquashfs", "-f", "-d", TARGET, SQUASH]]),
        ("הגדרות מערכת", [("write", TARGET + "/etc/hostname", "dani-os\n"),
                          ("write", TARGET + "/etc/timezone", cfg["timezone"] + "\n"),
                          ("write", TARGET + "/etc/default/keyboard", f'XKBLAYOUT="{cfg["keyboard"]}"\n'),
                          ("write", TARGET + "/etc/default/locale", f'LANG={cfg["language"]}_{cfg["country"]}.UTF-8\n'),
                          ("write", TARGET + "/etc/dani-edition", cfg["edition"] + "\n"),
                          ("write", TARGET + "/etc/systemd/system/getty@tty1.service.d/autologin.conf",
                           f"[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin {u} --noclear %I $TERM\n")]
                         + ([("write", TARGET + "/opt/dani-os/Shared/profile.json", profile_json(cfg, u))] if cfg.get("username") else [])),
        ("יצירת משתמש", user_steps(cfg, u)),
        ("מטען אתחול", [["mount", "--bind", "/dev", TARGET + "/dev"], ["mount", "--bind", "/sys", TARGET + "/sys"], ["mount", "--bind", "/proc", TARGET + "/proc"],
                        ("fstab", p1, p2),
                        ["chroot", TARGET, "update-initramfs", "-u", "-k", "all"],
                        ["chroot", TARGET, "grub-install", "--target=x86_64-efi", "--efi-directory=/boot/efi", "--bootloader-id=DANI-OS", "--removable"],
                        ["chroot", TARGET, "update-grub"]]),
    ]
    pk = EDITIONS[cfg["edition"]]
    if pk:
        steps.append(("חבילות המהדורה", [("resolv",),["chroot", TARGET, "apt-get", "install", "-y", "--no-install-recommends"] + pk]))
    steps.append(("ניקוי", [["umount", "-R", TARGET]]))
    return steps


def user_steps(cfg, u):
    # the live user is created by live-config at boot, so it is NOT inside the squashfs: create the real user here
    steps = [["chroot", TARGET, "useradd", "-m", "-s", "/bin/bash", "-G", "sudo,audio,video,render,input,netdev,plugdev", u]]
    steps.append(("password", u) if cfg.get("password") else ["chroot", TARGET, "passwd", "-d", u])
    return steps


def run_install(cfg, emit):
    validate(cfg)
    emit(f"{'הרצה אמיתית' if EXECUTE else 'DRY-RUN (לא משנה כלום)'} → {cfg['disk']}\n")
    for title, cmds in plan(cfg):
        emit(f"\n== {title} ==\n")
        for c in cmds:
            if isinstance(c, tuple) and c[0] == "write":
                emit(f"write {c[1]}\n")
                if EXECUTE:
                    os.makedirs(os.path.dirname(c[1]), exist_ok=True)
                    open(c[1], "w").write(c[2])
            elif isinstance(c, tuple) and c[0] == "fstab":
                emit("write /etc/fstab (by UUID)\n")
                if EXECUTE:
                    uu = lambda d: subprocess.run(["blkid", "-s", "UUID", "-o", "value", d], capture_output=True, text=True, check=True).stdout.strip()
                    open(TARGET + "/etc/fstab", "w").write(f"UUID={uu(c[2])} / ext4 errors=remount-ro 0 1\nUUID={uu(c[1])} /boot/efi vfat umask=0077 0 2\n")
            elif isinstance(c, tuple) and c[0] == "resolv":
                emit("copy /etc/resolv.conf (network for apt in chroot)\n")
                if EXECUTE:
                    for m in ("/dev", "/sys", "/proc"):
                        pass
                    if os.path.islink(TARGET + "/etc/resolv.conf"):
                        os.remove(TARGET + "/etc/resolv.conf")
                    open(TARGET + "/etc/resolv.conf", "w").write(open("/etc/resolv.conf").read())
            elif isinstance(c, tuple) and c[0] == "password":
                emit(f"set password for {c[1]} (hash only)\n")
                if EXECUTE:
                    h = subprocess.run(["openssl", "passwd", "-6", "-stdin"], input=cfg["password"], capture_output=True, text=True, check=True).stdout.strip()
                    subprocess.run(["chroot", TARGET, "chpasswd", "-e"], input=f"{c[1]}:{h}\n", text=True, check=True)
            else:
                emit("$ " + shlex.join(c) + "\n")
                if EXECUTE:
                    r = subprocess.run(c, capture_output=True, text=True)
                    emit((r.stdout + r.stderr)[-800:])
                    if r.returncode:
                        emit(f"נכשל (קוד {r.returncode}) – עוצר.\n")
                        return
    emit("\nההתקנה הסתיימה." if EXECUTE else "\nסוף DRY-RUN.")


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == "/disks":
            b = json.dumps({"disks": disks()}).encode()
            self.send_response(200); self._cors(); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != "/install":
            self.send_response(404); self.end_headers(); return
        cfg = json.loads(self.rfile.read(min(int(self.headers.get("content-length", 0)), 4_000_000)) or b"{}")
        self.send_response(200); self._cors(); self.send_header("content-type", "text/plain; charset=utf-8"); self.end_headers()
        emit = lambda s: (self.wfile.write(s.encode()), self.wfile.flush())
        try:
            run_install(cfg, emit)
        except Exception as e:
            emit(f"שגיאה: {e}\n")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"DANI installer backend :7790 execute={EXECUTE} live={LIVE}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", 7790), H).serve_forever()
