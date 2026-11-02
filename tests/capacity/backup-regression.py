"""Backup failure boundaries. Optional real restic round trip uses synthetic data only."""
import importlib.util
import io
import contextlib
import plistlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backup-restaurant.py"
spec = importlib.util.spec_from_file_location("restaurant_backup", SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_reject_path_traversal_private_objects_and_case_collisions(self):
        valid = {"id": "fixture", "bucket_id": "food-images", "name": "1/photo.jpg", "updated_at": "fixed", "metadata": {"size": 4}, "public": True}
        invalid_rows = [
            [{**valid, "name": "../secret"}], [{**valid, "name": "/secret"}],
            [{**valid, "name": "a//b"}], [{**valid, "name": "a/./b"}],
            [{**valid, "name": "a\\b"}], [{**valid, "bucket_id": ".."}],
            [{**valid, "public": False}], [valid, {**valid, "name": "1/PHOTO.JPG"}],
            [{**valid, "name": "caf\u00e9"}, {**valid, "name": "cafe\u0301"}],
        ]
        for rows in invalid_rows:
            with self.subTest(rows=rows), patch.object(backup, "query", return_value=json.dumps(rows)):
                with self.assertRaises(backup.BackupError):
                    backup.inventory({}, {})
        with patch.object(backup, "query", return_value=json.dumps([valid])):
            self.assertEqual(backup.inventory({}, {}), [valid])

    def test_credentials_are_private_and_not_printed(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / "key"
            key.write_text("SYNTHETIC_SECRET_NEVER_PRINT")
            key.chmod(0o644)
            with self.assertRaises(backup.BackupError):
                backup.private_file(key)
            key.chmod(0o600)
            self.assertEqual(backup.private_file(key), key)
            try:
                backup.run("/bin/sh", ["-c", "echo SYNTHETIC_SECRET_NEVER_PRINT >&2; exit 3"], {})
            except backup.BackupError as error:
                self.assertNotIn("SYNTHETIC_SECRET_NEVER_PRINT", str(error))
            else:
                self.fail("Nonzero command status must fail the backup")

    def test_archive_cannot_escape_or_create_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, kind in [("../outside", tarfile.REGTYPE), ("restaurant/link", tarfile.SYMTYPE), ("restaurant/hard", tarfile.LNKTYPE)]:
                archive = root / "bad.tar"
                with tarfile.open(archive, "w") as output:
                    entry = tarfile.TarInfo(name)
                    entry.type = kind
                    entry.linkname = "/outside"
                    output.addfile(entry, io.BytesIO())
                with self.assertRaises(backup.BackupError):
                    backup.verify_bundle(archive, root / "restore")
            self.assertFalse((root / "outside").exists())

    def test_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "bad.tar"
            with tarfile.open(archive, "w") as output:
                for name, data in [("manifest.json", json.dumps({"format_version": 1, "project": backup.PROJECT, "files": {"database.dump": "wrong"}}).encode()), ("database.dump", b"synthetic")]:
                    entry = tarfile.TarInfo("restaurant/" + name)
                    entry.size = len(data)
                    output.addfile(entry, io.BytesIO(data))
            with self.assertRaises(backup.BackupError):
                backup.verify_bundle(archive, root / "restore")

    def test_schedule_requires_verified_backup_and_never_replaces_existing_job(self):
        spec = importlib.util.spec_from_file_location("restaurant_schedule", SCRIPT.with_name("install-backup-schedule.py"))
        schedule = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(schedule)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "private-config.json"
            plist = root / "Library" / "LaunchAgents" / (schedule.LABEL + ".plist")
            with patch.object(schedule.sys, "platform", "darwin"), patch.object(schedule.sys, "argv", ["installer", "--config", str(config)]), patch.object(schedule.Path, "home", return_value=root):
                with patch.object(schedule.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "SYNTHETIC_SECRET", "SYNTHETIC_SECRET")) as run, contextlib.redirect_stdout(io.StringIO()) as output:
                    self.assertEqual(schedule.main(), 1)
                    self.assertFalse(plist.exists())
                    self.assertEqual(run.call_count, 1)
                    self.assertNotIn("SYNTHETIC_SECRET", output.getvalue())
                checkpoint = json.dumps({"ok": True, "snapshot_id": "01234567"})
                with patch.object(schedule.subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0, checkpoint, ""), subprocess.CompletedProcess([], 0, b"", b"")]) as run, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(schedule.main(), 0)
                    job = plistlib.loads(plist.read_bytes())
                    self.assertEqual(job["StartCalendarInterval"], {"Hour": 3, "Minute": 20})
                    self.assertFalse(job["RunAtLoad"], "Initial backup was already verified; do not immediately duplicate it")
                    self.assertEqual(job["ProgramArguments"][-2:], ["--config", str(config)])
                    self.assertEqual(run.call_count, 2)
                saved = plist.read_bytes()
                with patch.object(schedule.subprocess, "run") as run, contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(schedule.main(), 1)
                    self.assertEqual(plist.read_bytes(), saved)
                    run.assert_not_called()

    @unittest.skipUnless(os.environ.get("RESTIC_TEST_BIN"), "Set RESTIC_TEST_BIN for a real encrypted round trip")
    def test_real_restic_synthetic_round_trip_and_changed_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / "tools"
            tools.mkdir()
            for name in ["service", "pgpass", "restic-key"]:
                (root / name).write_text("synthetic-fixture-only")
                (root / name).chmod(0o600)
            (root / "service").write_text("[fixture]\nhost=aws-0-eu-west-1.pooler.supabase.com\nport=5432\ndbname=postgres\nuser=postgres." + backup.PROJECT + "\n")
            fake = '''#!/usr/bin/env python3
from pathlib import Path
import os,sys
name=Path(sys.argv[0]).name
if '--version' in sys.argv: print(name+' (PostgreSQL) 17.11');sys.exit(0)
if name=='psql': print('17.6');sys.exit(0)
if name=='pg_dump': Path(sys.argv[sys.argv.index('--file')+1]).write_bytes(b'PGDMP synthetic fixture, no real data');sys.exit(0)
if name=='pg_dumpall':
 assert '--no-role-passwords' in sys.argv and '--roles-only' in sys.argv and '--dbname' in sys.argv
 Path(sys.argv[sys.argv.index('--file')+1]).write_text('CREATE ROLE synthetic_fixture NOLOGIN;');sys.exit(0)
if name=='pg_restore': assert Path(sys.argv[-1]).read_bytes().startswith(b'PGDMP');sys.exit(0)
raise AssertionError(name)
'''
            for name in ["psql", "pg_dump", "pg_dumpall", "pg_restore"]:
                (tools / name).write_text(fake)
                (tools / name).chmod(0o700)
            config = {"pg_bin": str(tools), "pg_service": "fixture", "pg_service_file": str(root / "service"), "pg_password_file": str(root / "pgpass"), "restic": os.environ["RESTIC_TEST_BIN"], "restic_repository": str(root / "encrypted-repository"), "restic_password_file": str(root / "restic-key")}
            filename = root / "config.json"
            filename.write_text(json.dumps(config))
            filename.chmod(0o600)
            config = backup.load_config(filename)
            original_service = (root / "service").read_text()
            (root / "service").write_text(original_service.replace(backup.PROJECT, "wrong-project"))
            with self.assertRaises(backup.BackupError):
                backup.load_config(filename)
            (root / "service").write_text(original_service)
            env = backup.environment(config)
            subprocess.run([config["restic"], "init"], env=env, check=True, capture_output=True)
            rows = [{"id": "fixture", "bucket_id": "food-images", "name": "1/manifest.json", "updated_at": "fixed", "metadata": {"size": 4}, "public": True}]
            def downloader(row, target, key):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"test")
            with patch.object(backup, "inventory", side_effect=[rows, rows]):
                result = backup.backup(config, downloader=downloader)
            self.assertTrue(result["ok"])
            self.assertEqual(result["storage_objects"], 1)
            self.assertRegex(result["snapshot_id"], r"^[0-9a-f]{8,64}$")
            for path in (root / "encrypted-repository").rglob("*"):
                if path.is_file():
                    self.assertNotIn(b"PGDMP synthetic fixture", path.read_bytes())
            with patch.object(backup, "inventory", side_effect=[rows, [{**rows[0], "updated_at": "changed"}]]):
                with self.assertRaises(backup.BackupError):
                    backup.backup(config, downloader=downloader)
            snapshots = json.loads(subprocess.check_output([config["restic"], "snapshots", "--json"], env=env))
            self.assertEqual(len(snapshots), 1, "Changed Storage must not create an accepted snapshot")


if __name__ == "__main__":
    unittest.main(verbosity=2)
