import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// This fixture creates only uniquely named, synthetic objects. Failed and
// successful evidence objects are deliberately retained; there is no unlink,
// remove, recursive cleanup, credential, photo or device operation here.
const parent = process.env.SMART_PM_SYNTHETIC_EVIDENCE_ROOT
  ?? path.join(os.tmpdir(), 'SMART-PM-SYNTHETIC-WINDOWS-EVIDENCE');
const roles = { stdout: 'stdout.jsonl', stderr: 'stderr.txt', 'main-exit': 'main-exit.txt' };
export const textByRole = Object.freeze({ stdout: '{"kind":"synthetic-native-evidence","text":"合成"}\n', stderr: '', 'main-exit': '0\n' });
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const reference = () => `SYNTHETIC_${randomUUID().replaceAll('-', '')}`;
export function syntheticBase() {
  assert.equal(process.platform, 'win32', 'These native cases require actual Windows; a skip is not evidence');
  fs.mkdirSync(parent, { recursive: true });
  const baseDirectory = path.join(parent, `case_${randomUUID().replaceAll('-', '')}`);
  fs.mkdirSync(baseDirectory, { recursive: false });
  return baseDirectory;
}
export function safeNative(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(text, /S-\d-\d+(?:-\d+)+|[A-Za-z]:[\\/]|BEGIN (?:CERTIFICATE|PRIVATE KEY)|\n\s+at /);
}
export function nativeError(error) {
  assert.match(error?.code ?? '', /^NATIVE_EVIDENCE_[A-Z0-9_]+$/);
  safeNative({ code: error.code, message: error.message });
  return true;
}
export async function closeQuiet(store, close) {
  try { await close(store); } catch (error) { nativeError(error); }
}
function powershell(script, input) {
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', input: JSON.stringify(input), timeout: 8000,
    env: { SystemRoot: process.env.SystemRoot, windir: process.env.SystemRoot }, maxBuffer: 262144,
  });
  assert.equal(result.error?.code, undefined, 'The fixed native inspection must start and finish');
  assert.equal(result.signal, null); assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout); safeNative(parsed); return parsed;
}
export function inspectPrivateAcl(directory, { sealed = true } = {}) {
  return powershell(`$ErrorActionPreference='Stop'; try {
    $inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json;
    $current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    $expected=@($current,'S-1-5-18'); $results=@();
    foreach($item in $inputData.names){
      $location=if($item -eq '.'){[string]$inputData.directory}else{Join-Path ([string]$inputData.directory) ([string]$item)};
      $acl=Get-Acl -LiteralPath $location;
      $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));
      $allowed=$rules.Count -eq 2;
      foreach($rule in $rules){
        $allowed=$allowed -and ($expected -contains $rule.IdentityReference.Value) -and
          $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
          (-not $rule.IsInherited) -and
          $rule.FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl;
      }
      $results+=@{name=$item;ownerCurrent=($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $current);
        protected=[bool]$acl.AreAccessRulesProtected;allowedExactly=[bool]$allowed;ruleCount=$rules.Count};
    }
    [Console]::Out.WriteLine((@{kind='synthetic-acl-inspection';rows=@($results)} | ConvertTo-Json -Compress -Depth 6));
    exit 0;
  }catch{[Console]::Error.WriteLine('SYNTHETIC_ACL_INSPECTION_FAILED');exit 2}`, {
    directory, names: ['.', ...Object.values(roles), ...(sealed ? ['candidate-seal.json'] : [])],
  });
}
export function tightenSyntheticAcl(file) {
  return powershell(`$ErrorActionPreference='Stop'; try {
    $inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json;
    $current=[Security.Principal.WindowsIdentity]::GetCurrent().User;
    $acl=Get-Acl -LiteralPath ([string]$inputData.file);
    $deny=New-Object Security.AccessControl.FileSystemAccessRule($current,[Security.AccessControl.FileSystemRights]::Delete,[Security.AccessControl.AccessControlType]::Deny);
    $acl.AddAccessRule($deny); Set-Acl -LiteralPath ([string]$inputData.file) -AclObject $acl;
    [Console]::Out.WriteLine('{"changed":true,"blocked":false,"category":"CHANGED"}');exit 0;
  }catch{
    $cause=$_.Exception; while($null -ne $cause.InnerException){$cause=$cause.InnerException};
    if($cause -is [UnauthorizedAccessException] -or $cause -is [Security.SecurityException]){
      [Console]::Out.WriteLine('{"changed":false,"blocked":true,"category":"ACCESS_DENIED"}');exit 0;
    }
    if(($cause -is [IO.IOException] -and (($cause.HResult -band 65535) -in @(5,32,33))) -or
       ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -in @(5,32,33))){
      [Console]::Out.WriteLine('{"changed":false,"blocked":true,"category":"ACCESS_OR_SHARING_DENIED"}');exit 0;
    }
    [Console]::Error.WriteLine('SYNTHETIC_ACL_MUTATION_FAILED');exit 2;
  }`, { file });
}
export function inspectDisk(directory, expected = textByRole) {
  assert.deepEqual(fs.readdirSync(directory).sort(), [...Object.values(roles), 'candidate-seal.json'].sort());
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'candidate-seal.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.reference, path.basename(directory));
  assert.equal(manifest.kind, 'candidate-only'); assert.equal(manifest.finalResultRequired, true);
  assert.deepEqual(manifest.files.map(row => row.role), Object.keys(roles));
  for (const [role, file] of Object.entries(roles)) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert(bytes.equals(Buffer.from(expected[role])));
    const row = manifest.files.find(item => item.role === role);
    assert.deepEqual(row, { role, file, bytes: bytes.length, sha256: sha256(bytes) });
    const stat = fs.lstatSync(path.join(directory, file));
    assert.equal(stat.isFile(), true); assert.equal(stat.isSymbolicLink(), false); assert.equal(stat.nlink, 1);
  }
  const acl = inspectPrivateAcl(directory);
  for (const row of acl.rows) {
    assert.equal(row.ownerCurrent, true); assert.equal(row.protected, true);
    assert.equal(row.allowedExactly, true); assert.equal(row.ruleCount, 2);
  }
  return manifest;
}
export { roles };
