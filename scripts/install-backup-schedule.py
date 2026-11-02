#!/usr/bin/env python3
"""Install a per-user macOS backup job after private configuration is complete."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys

LABEL = "com.ai-restaurace.backup"


def launchd_job(config, log_directory):
    return {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(Path(__file__).with_name("backup-restaurant.py").resolve()), "--config", str(config)],
        "StartCalendarInterval": {"Hour": 3, "Minute": 20},
        "RunAtLoad": False,
        "ProcessType": "Background",
        "StandardOutPath": str(log_directory / "backup.log"),
        "StandardErrorPath": str(log_directory / "backup-error.log"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This installer must run on the owner's Mac. No schedule was installed here.")
    os.umask(0o077)
    config = Path(args.config).expanduser().resolve()
    backup = Path(__file__).with_name("backup-restaurant.py").resolve()
    agents = Path.home() / "Library" / "LaunchAgents"
    plist = agents / (LABEL + ".plist")
    if plist.exists():
        print(json.dumps({"ok": False, "schedule_installed": False, "error": "A backup schedule already exists. Review it before replacing it."}))
        return 1
    # Confirm the encrypted export and readback before enabling any recurring job.
    # On failure the existing scheduler is left untouched.
    result = subprocess.run([sys.executable, str(backup), "--config", str(config)], capture_output=True, text=True)
    try:
        checkpoint = json.loads(result.stdout)
    except json.JSONDecodeError:
        checkpoint = {"ok": False}
    if result.returncode or checkpoint.get("ok") is not True:
        print(json.dumps({"ok": False, "schedule_installed": False, "error": "The initial backup was not verified. Fix private configuration before scheduling."}))
        return 1
    support = Path.home() / "Library" / "Application Support" / "AI-Restaurace-Backup"
    support.mkdir(parents=True, exist_ok=True, mode=0o700)
    (support / "last-verified-installation-backup.json").write_text(json.dumps(checkpoint, indent=2))
    agents.mkdir(parents=True, exist_ok=True)
    logs = Path.home() / "Library" / "Logs" / "AI-Restaurace-Backup"
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        with plist.open("xb") as output:
            plistlib.dump(launchd_job(config, logs), output)
    except FileExistsError:
        print(json.dumps({"ok": False, "schedule_installed": False, "error": "A schedule appeared during installation; it was not replaced."}))
        return 1
    loaded = subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], capture_output=True)
    if loaded.returncode:
        # This installer created the new file in this run; remove only that uninstalled entry.
        plist.unlink()
        print(json.dumps({"ok": False, "schedule_installed": False, "error": "macOS did not accept the new schedule. The verified backup is retained."}))
        return 1
    print(json.dumps({"ok": True, "schedule_installed": True, "hour": "03:20 local Mac time", "initial_backup": checkpoint["snapshot_id"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
