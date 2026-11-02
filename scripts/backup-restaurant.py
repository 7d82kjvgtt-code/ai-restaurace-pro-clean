#!/usr/bin/env python3
"""Read-only Supabase export to an existing encrypted restic repository.

No credentials are accepted as command-line values. No database restore, email,
repository initialization or snapshot deletion is performed by this program.
"""
import argparse
import configparser
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unicodedata
import urllib.parse
import urllib.request

PROJECT = "decpnnbaejxjbpmyjocs"
ORIGIN = f"https://{PROJECT}.supabase.co"
REPO_ROOT = Path(__file__).resolve().parent.parent
TAG = f"restaurant-{PROJECT}"
STORAGE_QUERY = """select coalesce(json_agg(row_to_json(s) order by s.bucket_id,s.name),'[]'::json) from (
select o.id::text,o.bucket_id,o.name,o.updated_at::text,o.metadata,b.public
from storage.objects o join storage.buckets b on b.id=o.bucket_id
order by o.bucket_id,o.name) s"""


class BackupError(Exception):
    pass


def private_file(value):
    path = Path(value).expanduser().resolve()
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise BackupError("Credential files must belong to the current user and have mode 600 or stricter.")
    if path.is_relative_to(REPO_ROOT):
        raise BackupError("Credential files must be outside the source repository.")
    if not info.st_size:
        raise BackupError("A required credential file is empty.")
    return path


def binary(path):
    resolved = shutil.which(str(path))
    if not resolved:
        raise BackupError("A required program is missing. Install PostgreSQL 17 clients and restic first.")
    return resolved


def load_config(filename):
    config = json.loads(private_file(filename).read_text())
    required = {"pg_bin", "pg_service", "pg_service_file", "pg_password_file", "restic", "restic_repository", "restic_password_file"}
    if not isinstance(config, dict) or not required.issubset(config):
        raise BackupError("Backup configuration is incomplete.")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", config["pg_service"]):
        raise BackupError("Invalid PostgreSQL service name.")
    for key in ["pg_service_file", "pg_password_file", "restic_password_file"]:
        config[key] = str(private_file(config[key]))
    if config.get("storage_key_file"):
        config["storage_key_file"] = str(private_file(config["storage_key_file"]))
    services = configparser.ConfigParser(interpolation=None)
    services.read(config["pg_service_file"])
    if config["pg_service"] not in services:
        raise BackupError("The PostgreSQL service entry is missing.")
    connection = services[config["pg_service"]]
    host, user = connection.get("host", ""), connection.get("user", "")
    expected = ((host == "aws-0-eu-west-1.pooler.supabase.com" and user == "postgres." + PROJECT)
                or (host == "db." + PROJECT + ".supabase.co" and user == "postgres"))
    if not expected or connection.get("port", "5432") != "5432" or connection.get("dbname", "postgres") != "postgres":
        raise BackupError("The PostgreSQL service does not identify the expected restaurant project and session connection.")
    pg_bin = Path(config["pg_bin"]).expanduser()
    config["programs"] = {name: binary(pg_bin / name) for name in ["psql", "pg_dump", "pg_dumpall", "pg_restore"]}
    config["restic"] = binary(config["restic"])
    # Prefer an external config file. Reject an obvious local destination inside the public source tree.
    target = config["restic_repository"]
    if not isinstance(target, str) or not target.strip():
        raise BackupError("An existing private restic repository is required.")
    if ":" not in target and Path(target).expanduser().resolve().is_relative_to(REPO_ROOT):
        raise BackupError("The backup destination must be outside the source repository.")
    return config


def environment(config):
    env = os.environ.copy()
    for key in ["PGPASSWORD", "RESTIC_PASSWORD", "RESTIC_PASSWORD_COMMAND", "RESTIC_REPOSITORY_FILE"]:
        env.pop(key, None)
    env.update(PGSERVICE=config["pg_service"], PGSERVICEFILE=config["pg_service_file"],
               PGPASSFILE=config["pg_password_file"], PGSSLMODE="require", PGCONNECT_TIMEOUT="15",
               PGOPTIONS="-c default_transaction_read_only=on",
               RESTIC_REPOSITORY=config["restic_repository"], RESTIC_PASSWORD_FILE=config["restic_password_file"])
    return env


def run(program, args, env, *, output=None, input_file=None, timeout=900):
    try:
        result = subprocess.run([program, *args], env=env, stdin=input_file or subprocess.DEVNULL,
                                stdout=output or subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BackupError("A backup command failed or timed out. No success checkpoint was written.") from exc
    if result.returncode:
        # Server diagnostics may contain personal data or credentials. Do not echo them to CI logs.
        raise BackupError(f"Backup command failed (exit {result.returncode}). No success checkpoint was written.")
    return result.stdout if output is None else None


def query(config, env, sql):
    data = run(config["programs"]["psql"], ["-X", "-q", "-A", "-t", "--no-password", "--set=ON_ERROR_STOP=1", "--command", sql], env)
    return data.decode().strip()


def inventory(config, env):
    rows = json.loads(query(config, env, STORAGE_QUERY))
    if not isinstance(rows, list):
        raise BackupError("Invalid Storage inventory.")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", str(row.get("bucket_id", ""))):
            raise BackupError("Invalid Storage bucket.")
        name = row.get("name")
        if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
            raise BackupError("Invalid Storage object path.")
        path = PurePosixPath(name)
        if path.is_absolute() or any(part in {".", "..", ""} for part in name.split("/")):
            raise BackupError("Unsafe Storage object path.")
        folded = unicodedata.normalize("NFC", row["bucket_id"] + "/" + name).casefold()
        if folded in seen:
            raise BackupError("Storage object paths collide on a case-insensitive filesystem.")
        seen.add(folded)
        if row.get("public") is not True and not config.get("storage_key_file"):
            raise BackupError("Private Storage objects require a server key file outside the repository.")
    return rows


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BackupError("Storage redirected unexpectedly. No credentials were forwarded.")


def download_object(row, target, key=None):
    bucket = urllib.parse.quote(row["bucket_id"], safe="")
    name = urllib.parse.quote(row["name"], safe="/")
    prefix = "public/" if row.get("public") is True else ""
    headers = {"User-Agent": "restaurant-backup/1"}
    if not prefix:
        headers.update(Authorization=f"Bearer {key}", apikey=key)
    request = urllib.request.Request(f"{ORIGIN}/storage/v1/object/{prefix}{bucket}/{name}", headers=headers)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response, target.open("xb") as output:
            shutil.copyfileobj(response, output)
    except Exception as exc:
        raise BackupError("A Storage object could not be downloaded. The backup was not accepted.") from exc
    expected = (row.get("metadata") or {}).get("size")
    if expected is not None and target.stat().st_size != int(expected):
        raise BackupError("A downloaded Storage object has the wrong size.")


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def verify_bundle(archive, target):
    with tarfile.open(archive, "r") as source:
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "restaurant" or not (member.isfile() or member.isdir()):
                raise BackupError("Unsafe entry in the restored archive.")
            destination = target.joinpath(*path.parts)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with source.extractfile(member) as incoming, destination.open("xb") as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
    root = target / "restaurant"
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest.get("format_version") != 1 or manifest.get("project") != PROJECT:
        raise BackupError("Unexpected restored backup format or project.")
    actual = {p.relative_to(root).as_posix(): digest(p) for p in root.rglob("*") if p.is_file() and p != root / "manifest.json"}
    if actual != manifest["files"]:
        raise BackupError("The restored backup hashes do not match the exported data.")
    return root


def backup(config, *, downloader=download_object):
    env = environment(config)
    version = query(config, env, "show server_version")
    if version.split(".")[0] != "17":
        raise BackupError("This recovery procedure requires PostgreSQL 17. Review it before exporting another major version.")
    for name in ["pg_dump", "pg_restore"]:
        client = run(config["programs"][name], ["--version"], env).decode()
        if not re.search(r"\b17\.", client):
            raise BackupError("PostgreSQL 17 client programs are required.")
    # Never initialize a repository silently or send cleartext to a fallback destination.
    json.loads(run(config["restic"], ["snapshots", "--json", "--tag", TAG], env))
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    before = inventory(config, env)
    with tempfile.TemporaryDirectory(prefix="restaurant-backup-") as directory:
        work = Path(directory)
        payload = work / "payload"
        payload.mkdir(mode=0o700)
        dump = payload / "database.dump"
        run(config["programs"]["pg_dump"], ["--no-password", "--format=custom", "--file", str(dump)], env)
        run(config["programs"]["pg_restore"], ["--file", os.devnull, str(dump)], env)
        run(config["programs"]["pg_dumpall"], ["--no-password", "--roles-only", "--no-role-passwords", "--dbname", "service=" + config["pg_service"], "--file", str(payload / "roles.sql")], env)
        key = Path(config["storage_key_file"]).read_text().strip() if config.get("storage_key_file") else None
        for row in before:
            downloader(row, payload / "storage" / row["bucket_id"] / row["name"], key)
        if inventory(config, env) != before:
            raise BackupError("Storage changed during the export. Retry later; this backup was not accepted.")
        (payload / "storage-inventory.json").write_text(json.dumps(before, ensure_ascii=False, indent=2))
        files = {p.relative_to(payload).as_posix(): digest(p) for p in payload.rglob("*") if p.is_file()}
        manifest = dict(format_version=1, project=PROJECT, started_at=started,
                        exported_at=dt.datetime.now(dt.timezone.utc).isoformat(), server_version=version, files=files)
        (payload / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
        archive = work / "restaurant-backup.tar"
        with tarfile.open(archive, "w") as output:
            output.add(payload, arcname="restaurant")
        with archive.open("rb") as incoming:
            result = run(config["restic"], ["backup", "--stdin", "--stdin-filename", "restaurant-backup.tar", "--tag", TAG, "--json"], env, input_file=incoming)
        summaries = [entry for line in result.decode().splitlines() if (entry := json.loads(line)).get("message_type") == "summary"]
        snapshot = summaries[-1].get("snapshot_id") if summaries else None
        if not isinstance(snapshot, str) or not re.fullmatch(r"[0-9a-f]{8,64}", snapshot):
            raise BackupError("The encrypted snapshot was not confirmed.")
        restored_archive = work / "restored.tar"
        with restored_archive.open("xb") as output:
            run(config["restic"], ["dump", snapshot, "restaurant-backup.tar"], env, output=output)
        restored = verify_bundle(restored_archive, work / "verification")
        run(config["programs"]["pg_restore"], ["--file", os.devnull, str(restored / "database.dump")], env)
        return dict(ok=True, project=PROJECT, snapshot_id=snapshot, verified_at=dt.datetime.now(dt.timezone.utc).isoformat(),
                    storage_objects=len(before), verification="encrypted round trip, SHA-256 and archive readability; not a full Supabase recovery")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Path to a local configuration JSON file (no secrets in arguments)")
    parser.add_argument("--check-config", action="store_true", help="Validate local files/programs without connecting")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        config = load_config(args.config)
        result = {"ok": True, "configuration_valid": True, "backup_performed": False} if args.check_config else backup(config)
        if not args.check_config:
            parent = Path(args.config).expanduser().resolve().parent
            with tempfile.NamedTemporaryFile(mode="w", dir=parent, prefix=".verified-backup-", delete=False) as output:
                json.dump(result, output, indent=2)
                checkpoint = output.name
            os.replace(checkpoint, parent / "last-verified-backup.json")
        print(json.dumps(result))
    except Exception as exc:
        # Do not print arbitrary exception text: filesystem/HTTP errors may reveal credentials or object names.
        print(json.dumps({"ok": False, "error": str(exc) if isinstance(exc, BackupError) else "Backup failed. Check the private configuration and dependency availability."}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
