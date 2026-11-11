# HK-AI-04 H2-d 并发/重放稳定性证据脚本。
#
# 每个场景每轮都启动一个独立的 `node --test` 进程，使用 Node 的
# `--test-name-pattern` 只执行目标用例；不以同一进程重复运行代替独立进程。
# 脚本只运行测试，不修改生产代码、不注册 HTTP、不调用 Provider、不连接设备。
[CmdletBinding()]
param(
  [ValidateRange(1, 100)]
  [int]$Rounds = 20,
  [string]$OutputPath = (Join-Path ([System.IO.Path]::GetTempPath()) "h2d-concurrency-summary.json")
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$admin = Join-Path $repo "admin-web"
$nodeVersion = (& node --version).Trim()

$groups = @(
  @{ Id = "same-slot"; Label = "同 slot 双请求"; File = "tests/face-h2d-acceptance.test.mjs"; Pattern = "H2D-R1" },
  @{ Id = "same-operation-key"; Label = "同 operation key 并发重放"; File = "tests/face-h2d-acceptance.test.mjs"; Pattern = "H2D-R2" },
  @{ Id = "blacklist-retry-success"; Label = "BLACKLIST_RETRY 一次后成功"; File = "tests/face-h2d-acceptance.test.mjs"; Pattern = "H2D-R3" },
  @{ Id = "blacklist-retry-exhausted"; Label = "BLACKLIST_RETRY 三次耗尽"; File = "tests/face-h2d-acceptance.test.mjs"; Pattern = "H2D-R4" },
  @{ Id = "d75-drop-context"; Label = "D75 丢弃 prepareAttempt 上下文"; File = "tests/face-grant-d-matrix.test.mjs"; Pattern = "C4 D75a" },
  @{ Id = "d75-old-token"; Label = "D75 跨 attempt 旧 token"; File = "tests/face-grant-d-matrix.test.mjs"; Pattern = "C4 D75b" },
  @{ Id = "d75-callback-rerun"; Label = "D75 同 attempt callback 重跑"; File = "tests/face-grant-d-matrix.test.mjs"; Pattern = "C4 D75d" },
  @{ Id = "decode-timeout-slot"; Label = "解码超时后槽位恢复"; File = "tests/face-biometric.test.mjs"; Pattern = "解码超时后槽位可恢复" }
)

$summary = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  nodeVersion = $nodeVersion
  rounds = $Rounds
  groups = @()
  totalRuns = 0
  totalPassed = 0
  totalFailed = 0
}

foreach ($group in $groups) {
  $roundsOut = @()
  for ($round = 1; $round -le $Rounds; $round++) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $admin
    try {
      $out = & node --test --test-isolation=none "--test-name-pattern=$($group.Pattern)" $group.File 2>&1 | Out-String
      $exitCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    $watch.Stop()
    $passMatch = [regex]::Match($out, "pass (\d+)")
    $failMatch = [regex]::Match($out, "fail (\d+)")
    $pass = if ($passMatch.Success) { [int]$passMatch.Groups[1].Value } else { 0 }
    $fail = if ($failMatch.Success) { [int]$failMatch.Groups[1].Value } else { 0 }
    $ok = ($exitCode -eq 0 -and $pass -ge 1 -and $fail -eq 0)
    $record = [ordered]@{
      round = $round
      ok = $ok
      exitCode = $exitCode
      pass = $pass
      fail = $fail
      durationMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
    }
    if (-not $ok) {
      $record.outputTail = (($out -split "`r?`n") | Select-Object -Last 25) -join "`n"
    }
    $roundsOut += $record
  }
  $passed = @($roundsOut | Where-Object { $_.ok }).Count
  $failed = $Rounds - $passed
  $summary.totalRuns += $Rounds
  $summary.totalPassed += $passed
  $summary.totalFailed += $failed
  $summary.groups += [ordered]@{
    id = $group.Id
    label = $group.Label
    file = $group.File
    pattern = $group.Pattern
    passed = $passed
    failed = $failed
    rounds = $roundsOut
  }
  "{0,-28} {1,2}/{2} passed, {3} failed" -f $group.Id, $passed, $Rounds, $failed
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 -Path $OutputPath
"summary: $OutputPath"
"total: $($summary.totalPassed)/$($summary.totalRuns) passed, $($summary.totalFailed) failed"
if ($summary.totalFailed -ne 0) { exit 1 }
