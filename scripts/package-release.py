#!/usr/bin/env python3
"""Build a tested source delivery from a clean Git commit; never include local caches."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()

def validate_archive(archive, destination):
    """Reject unsafe source entries before extracting any bytes."""
    base = Path(destination).resolve()
    seen = set()
    windows_prefixes = {}
    reserved = {'con', 'prn', 'aux', 'nul',
                *(f'com{i}' for i in range(1, 10)), *(f'lpt{i}' for i in range(1, 10))}
    for entry in archive.infolist():
        name = entry.filename
        parts = name.rstrip('/').split('/')
        if (not parts or parts[0] != 'SMART-PM' or '\\' in name
                or any(p in ('', '.', '..') or p.endswith((' ', '.'))
                       or re.search(r'[\x00-\x1f\x7f<>:"|?*]', p)
                       or p.split('.')[0].casefold() in reserved for p in parts)):
            raise SystemExit(f'Unsafe archive path: {name}')
        canonical = '/'.join(parts).casefold()
        if canonical in seen:
            raise SystemExit(f'Duplicate Windows archive path: {name}')
        seen.add(canonical)
        for length in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:length])
            prior = windows_prefixes.setdefault(prefix.casefold(), prefix)
            if prior != prefix:
                raise SystemExit(f'Ambiguous Windows archive path: {name}')
        target = (base / name).resolve()
        if not target.is_relative_to(base):
            raise SystemExit(f'Unsafe archive path: {name}')
        if ((entry.external_attr >> 16) & 0o170000) == 0o120000:
            raise SystemExit(f'Symlink is not a release input: {name}')
        if any(p.casefold() in ('node_modules', '.git', 'dist', '.env', 'project.private.config.json', 'secrets.local.md')
               or p.casefold().startswith('.env.') for p in parts):
            raise SystemExit(f'Forbidden delivery file: {name}')

def validation_commands(checkout, checkin_face=False):
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required to validate the extracted archive.')
    # These are hard gates in BOTH profiles, not optional tests that accept failure.
    commands = [
        [node, 'scripts/checkin-face-static-check.mjs'],
        [node, 'scripts/verify-checkin-face-sources.mjs'],
    ]
    if checkin_face:
        # Explicit offline profile: preserve the full legacy profile below, while
        # validating this candidate without its unrelated HTTP-listening suites.
        files = [str(p.relative_to(checkout)).replace(os.sep, '/')
                 for p in sorted((checkout / 'tests').glob('*.test.cjs'))]
        files += [
            'admin-web/tests/checkin-face-config.test.mjs',
            'admin-web/tests/checkin-face-worker.test.mjs',
            'admin-web/tests/tenant-password-accounts.test.mjs',
            'admin-web/tests/tenant-auth-cloud-database.test.mjs',
            'admin-web/tests/local-cloud-database.test.mjs',
            'admin-web/tests/tenant-password-routes.test.mjs',
            'admin-web/tests/qishanyuan-test-data.test.mjs',
            'tools/checkin-face-worker/tests/rework-r05-r06.test.mjs',
            'tools/checkin-face-worker/tests/rework-r08-r09.test.mjs',
            'tools/checkin-face-worker/tests/sdk-resolution.test.mjs',
        ]
        commands += [
            [node, '--require', './tests/support/d-network-guard.cjs', '--test', *files],
            [node, 'scripts/check-miniprogram.mjs'],
            [sys.executable, 'scripts/test-package-release.py'],
        ]
    else:
        npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if not npm:
            raise SystemExit('npm is required for the full release validation profile.')
        for args in (['test'], ['run', 'check'], ['run', 'test:admin']):
            if os.name == 'nt':
                # Explicit cmd launch handles the npm.cmd shim; all arguments
                # here are fixed, never taken from a request or credentials.
                commands.append([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/s', '/c',
                                 subprocess.list2cmdline([npm, *args])])
            else:
                commands.append([npm, *args])
    return commands

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true', help='Explicitly package the configured live integration build')
    parser.add_argument('--checkin-face', action='store_true',
                        help='Explicit guarded offline check-in/face validation profile; no HTTP or device tests')
    args = parser.parse_args()
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise SystemExit('Commit all release inputs first; working tree must be clean.')
    package = json.loads((ROOT / 'package.json').read_text())
    version = package['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
        raise SystemExit('Invalid release version')
    commit = git('rev-parse', 'HEAD')
    name = f'SMART-PM-v{version}'
    if args.checkin_face:
        name += f'-{commit[:8]}-checkin-face-test'
    payload = subprocess.check_output(['git', 'archive', '--format=zip', '--prefix=SMART-PM/', 'HEAD'], cwd=ROOT)
    report = []
    with zipfile.ZipFile(io.BytesIO(payload)) as archive, tempfile.TemporaryDirectory(prefix='smart-pm-release-') as tmp:
        validate_archive(archive, tmp)
        archive.extractall(tmp)
        checkout = Path(tmp) / 'SMART-PM'
        runtime = json.loads(subprocess.check_output(['node', '-e', "process.stdout.write(JSON.stringify(require('./miniprogram/config/runtime')))"], cwd=checkout))
        project = json.loads((checkout / 'project.config.json').read_text())
        expected_mode = 'live' if args.live else 'demo'
        if runtime.get('mode') != expected_mode or runtime.get('allowDeviceOperations') is not False:
            raise SystemExit('Release mode must match the explicit package command and device operations must stay disabled.')
        if args.live:
            if not re.fullmatch(r'wx[0-9a-f]{16}', project.get('appid', '')) or not re.fullmatch(r'[A-Za-z0-9_-]+', runtime.get('cloudEnv', '')):
                raise SystemExit('Live integration requires a valid AppID and confirmed cloud environment.')
        elif runtime.get('cloudEnv'):
            raise SystemExit('Demo delivery must not select a live cloud environment.')
        environment = dict(os.environ)
        if args.checkin_face:
            guard = checkout / 'tests/support/d-network-guard.cjs'
            environment['NODE_OPTIONS'] = (
                environment.get('NODE_OPTIONS', '') + ' --require ' + json.dumps(str(guard))
            ).strip()
        for command in validation_commands(checkout, args.checkin_face):
            result = subprocess.run(command, cwd=checkout, env=environment,
                                    text=True, encoding='utf-8', errors='replace',
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            report.append('$ ' + ' '.join(command) + '\n' + result.stdout)
            print(result.stdout, end='')
            if result.returncode:
                raise SystemExit(f'Archive validation failed: {command}')
    output = ROOT / 'dist' / name
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / (name + '.zip')
    archive_path.write_bytes(payload)
    checksum = hashlib.sha256(payload).hexdigest()
    (output / 'SHA256SUMS').write_text(f'{checksum}  {archive_path.name}\n')
    (output / 'test-report.txt').write_text(f'Version: {version}\nCommit: {commit}\nValidation: extracted source archive, mocked WeChat APIs\n\n' + '\n'.join(report))
    (output / 'release-manifest.json').write_text(json.dumps({
        'version': version, 'tag': None if args.checkin_face else 'v' + version, 'commit': commit,
        'validation_profile': 'checkin-face-offline' if args.checkin_face else 'full-legacy',
        'channel': ('checkin-face-experience-source' if args.checkin_face else
                    ('backend-integration' if args.live else 'interaction-test')), 'mode': expected_mode,
        'appid': project.get('appid'), 'cloudEnv': runtime.get('cloudEnv'),
        'platform_upload': 'not_performed',
        'cloud_deployment': 'not_performed',
        'artifact': archive_path.name, 'bytes': len(payload), 'sha256': checksum,
        'validated': (['extracted-source root synthetic tests', 'focused check-in/cloud/worker synthetic tests',
                       'static miniprogram checks', 'mandatory check-in source and request gates', 'archive safety tests']
                      if args.checkin_face else
                      ['extracted-source behavior tests', 'static miniprogram checks', 'admin HTTP permissions and workflow tests',
                       'mandatory check-in source and request gates']),
        'not_validated': ['WeChat compilation', 'device rendering', 'live cloud services', 'admin live cloud integration and deployment', 'hardware'],
    }, indent=2) + '\n')
    print(f'Delivery: {archive_path}\nSHA256: {checksum}')

if __name__ == '__main__':
    main()
