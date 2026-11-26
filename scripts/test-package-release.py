"""Archive safety and mandatory-gate tests. No SDK, HTTP or device execution."""
from pathlib import Path
import importlib.util
import io
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('package_release', Path(__file__).with_name('package-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ArchiveSafety(unittest.TestCase):
    def check_entry(self, name, symlink=False):
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            entry = zipfile.ZipInfo(name)
            if symlink:
                entry.external_attr = 0o120777 << 16
            archive.writestr(entry, b'synthetic-only')
        payload.seek(0)
        with tempfile.TemporaryDirectory() as destination, zipfile.ZipFile(payload) as archive:
            release.validate_archive(archive, destination)
            self.assertEqual(list(Path(destination).iterdir()), [], 'validation must not extract bytes')

    def test_ordinary_project_path(self):
        self.check_entry('SMART-PM/miniprogram/app.json')

    def test_cross_platform_traversal_and_ads(self):
        for name in ('SMART-PM/../outside', '/SMART-PM/absolute', 'other/app.json',
                     'SMART-PM/C:/secret', 'SMART-PM/a\\..\\outside', 'SMART-PM/a:stream',
                     'SMART-PM/folder./x', 'SMART-PM/folder /x', 'SMART-PM/CON',
                     'SMART-PM/nul.txt', 'SMART-PM/com1.log', 'SMART-PM/a\x01b'):
            with self.subTest(name=name), self.assertRaises(SystemExit):
                self.check_entry(name)

    def test_secrets_dependencies_and_symlinks(self):
        for name in ('SMART-PM/.env', 'SMART-PM/.env.production', 'SMART-PM/.env.example',
                     'SMART-PM/.ENV', 'SMART-PM/.ENV.PRODUCTION',
                     'SMART-PM/project.private.config.json', 'SMART-PM/node_modules/sdk/index.js',
                     'SMART-PM/dist/old.zip', 'SMART-PM/deliveries/old.zip',
                     'SMART-PM/tools/signed-remote-worker/worker.local.json',
                     'SMART-PM/.git/config', 'SMART-PM/secrets.local.md'):
            with self.subTest(name=name), self.assertRaises(SystemExit):
                self.check_entry(name)
        with self.assertRaises(SystemExit):
            self.check_entry('SMART-PM/link', symlink=True)

    def test_windows_case_aliases_and_duplicate_entries(self):
        for names in (['SMART-PM/A.js', 'SMART-PM/a.js'],
                      ['SMART-PM/Dir/a.js', 'SMART-PM/dir/b.js'],
                      ['SMART-PM/a.js', 'SMART-PM/a.js']):
            payload = io.BytesIO()
            with zipfile.ZipFile(payload, 'w') as archive:
                for name in names:
                    archive.writestr(name, b'synthetic')
            payload.seek(0)
            with tempfile.TemporaryDirectory() as destination, zipfile.ZipFile(payload) as archive, \
                    self.assertRaises(SystemExit):
                release.validate_archive(archive, destination)

    def test_gate_failure_precedes_test_execution_in_both_profiles(self):
        with tempfile.TemporaryDirectory() as destination:
            checkout = Path(destination)
            package = '{"version":"1.2.3"}'
            (checkout / 'package.json').write_text(package)
            payload = io.BytesIO()
            with zipfile.ZipFile(payload, 'w') as archive:
                archive.writestr('SMART-PM/package.json', package)
                archive.writestr('SMART-PM/project.config.json', '{"appid":"wx1111111111111111"}')
            runtime = b'{"mode":"live","cloudEnv":"synthetic-env","allowDeviceOperations":false}'
            for scoped in (False, True):
                calls = []
                def run(command, **kwargs):
                    calls.append(command)
                    status = 0 if command[1] == 'scripts/checkin-face-static-check.mjs' else 1
                    return release.subprocess.CompletedProcess(command, status, stdout='synthetic gate result\n')
                def output(command, **kwargs):
                    if command[:2] == ['git', 'archive']:
                        self.assertEqual(command[-3:], ['--', '.', ':(exclude)deliveries'])
                        return payload.getvalue()
                    return runtime
                argv = ['package-release.py', '--live'] + (['--checkin-face'] if scoped else [])
                with self.subTest(scoped=scoped), \
                        patch.object(release, 'ROOT', checkout), \
                        patch.object(release, 'git', side_effect=lambda *args: '' if args[0] == 'status' else '1' * 40), \
                        patch.object(release.sys, 'argv', argv), \
                        patch.object(release.shutil, 'which', side_effect=lambda name: name), \
                        patch.object(release.subprocess, 'check_output', side_effect=output), \
                        patch.object(release.subprocess, 'run', side_effect=run), \
                        self.assertRaisesRegex(SystemExit, 'Archive validation failed'):
                    release.main()
                self.assertEqual([c[1] for c in calls],
                                 ['scripts/checkin-face-static-check.mjs', 'scripts/verify-checkin-face-sources.mjs'])
                self.assertFalse((checkout / 'dist').exists(), 'failed source gate must produce no release directory')

    def test_offline_profile_preserves_legacy_http_profile(self):
        with tempfile.TemporaryDirectory() as destination:
            checkout = Path(destination)
            (checkout / 'tests').mkdir()
            with patch.object(release.shutil, 'which', side_effect=lambda name: name):
                scoped = release.validation_commands(checkout, True)
                legacy = release.validation_commands(checkout, False)
            self.assertTrue(any('test:admin' in str(c) for c in legacy))
            self.assertFalse(any('test:admin' in str(c) for c in scoped))
            self.assertTrue(any('--require' in c and '--test' in c for c in scoped))


if __name__ == '__main__':
    unittest.main(verbosity=2)
