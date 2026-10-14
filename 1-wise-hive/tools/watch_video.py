"""Run the Watch plugin (claude-video) on a video URL or file; prints its report (frame paths + transcript).

Used by the wise-hive:train skill and The Wise Hive Training rounds, which may run this one command:
    python <brain>\\tools\\watch_video.py "<url>" --question "<what to learn>" [--start 1:30 --end 4:00] [--resolution 1024]
- Reloads PATH from the registry first, so yt-dlp/ffmpeg are found even when the calling app started
  before they were installed (a stale PATH made Watch fail in Claude Desktop sessions on 2026-10-12).
- `python ...\\watch_video.py --clean` deletes the downloaded runs once notes are taken; runs older than 6 h are also removed on each call.
- Uses the newest installed watch version; frames go to <brain>\\training\\sandbox\\videos unless --out-dir is given.
Replaces watch-video.ps1: Claude Code refuses `powershell -File ...` (nested PowerShell) even with an allow rule.
Verified 2026-10-12 with watch 0.3.2.
"""
import os
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "training" / "sandbox" / "videos"   # this file is <brain>\tools\watch_video.py


def fresh_path():
    try:
        import winreg
    except ImportError:
        return os.environ.get("PATH", "")
    parts = []
    for root, key in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
                      (winreg.HKEY_CURRENT_USER, r"Environment")):
        try:
            with winreg.OpenKey(root, key) as k:
                parts.append(os.path.expandvars(winreg.QueryValueEx(k, "Path")[0]))
        except OSError:
            pass
    parts.append(os.environ.get("PATH", ""))
    return ";".join(p for p in parts if p)


def version_key(p):
    try:
        return tuple(int(x) for x in p.name.split("."))
    except ValueError:
        return (0,)


def clean(max_age_hours=None):
    """Delete watch-* run folders under OUT (all, or only those older than max_age_hours)."""
    import shutil
    import time
    if not OUT.exists():
        return 0
    n = 0
    for d in OUT.glob("watch-*"):
        if d.is_dir() and (max_age_hours is None or time.time() - d.stat().st_mtime > max_age_hours * 3600):
            shutil.rmtree(d, ignore_errors=True)
            n += 1
    return n


def main():
    if sys.argv[1:] == ["--clean"]:
        print(f"Removed {clean()} watch run folder(s) from {OUT}.")
        return 0
    clean(max_age_hours=6)  # leftovers from earlier runs
    root = Path.home() / ".claude" / "plugins" / "cache" / "claude-video" / "watch"
    versions = sorted((d for d in root.glob("*") if d.is_dir()), key=version_key) if root.exists() else []
    if not versions:
        print("Watch plugin is not installed (claude plugin install watch@claude-video).")
        return 2
    script = versions[-1] / "skills" / "watch" / "scripts" / "watch.py"
    args = sys.argv[1:]
    if "--out-dir" not in args:
        OUT.mkdir(parents=True, exist_ok=True)
        args += ["--out-dir", str(OUT)]
    env = dict(os.environ, PATH=fresh_path(), PYTHONIOENCODING="utf-8")
    return subprocess.run([sys.executable, str(script), *args], env=env).returncode


if __name__ == "__main__":
    sys.exit(main())
