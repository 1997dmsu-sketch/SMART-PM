#!/usr/bin/env python3
"""Build a tested source delivery from a clean Git commit; never include local caches."""
from pathlib import Path
import hashlib
import io
import json
import re
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()

def main():
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise SystemExit('Commit all release inputs first; working tree must be clean.')
    package = json.loads((ROOT / 'package.json').read_text())
    version = package['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
        raise SystemExit('Invalid release version')
    commit = git('rev-parse', 'HEAD')
    name = f'SMART-PM-v{version}'
    payload = subprocess.check_output(['git', 'archive', '--format=zip', '--prefix=SMART-PM/', 'HEAD'], cwd=ROOT)
    report = []
    with zipfile.ZipFile(io.BytesIO(payload)) as archive, tempfile.TemporaryDirectory(prefix='smart-pm-release-') as tmp:
        for entry in archive.infolist():
            target = (Path(tmp) / entry.filename).resolve()
            if not target.is_relative_to(Path(tmp).resolve()):
                raise SystemExit('Unsafe archive path')
            parts = Path(entry.filename).parts
            if any(p in ('node_modules', '.git', 'dist', '.env', 'project.private.config.json', 'secrets.local.md') or p.startswith('.env.') for p in parts):
                raise SystemExit(f'Forbidden delivery file: {entry.filename}')
        archive.extractall(tmp)
        checkout = Path(tmp) / 'SMART-PM'
        runtime = (checkout / 'miniprogram/config/runtime.js').read_text()
        # Evaluate the actual CommonJS config rather than searching comments.
        validation = subprocess.run(['node', '-e', "const c=require('./miniprogram/config/runtime');if(c.mode!=='demo'||c.cloudEnv||c.allowDeviceOperations)process.exit(1)"], cwd=checkout)
        if validation.returncode:
            raise SystemExit('This delivery must keep demo mode and device operations disabled.')
        for command in (['npm', 'test'], ['npm', 'run', 'check']):
            result = subprocess.run(command, cwd=checkout, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
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
        'version': version, 'tag': 'v' + version, 'commit': commit,
        'channel': 'interaction-test', 'mode': 'demo',
        'artifact': archive_path.name, 'bytes': len(payload), 'sha256': checksum,
        'validated': ['extracted-source behavior tests', 'static miniprogram checks'],
        'not_validated': ['WeChat compilation', 'device rendering', 'live cloud services', 'hardware'],
    }, indent=2) + '\n')
    print(f'Delivery: {archive_path}\nSHA256: {checksum}')

if __name__ == '__main__':
    main()
