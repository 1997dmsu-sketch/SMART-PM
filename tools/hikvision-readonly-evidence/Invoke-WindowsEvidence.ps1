$ErrorActionPreference = 'Stop'
try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        [Console]::Error.WriteLine('NATIVE_EVIDENCE_RUNTIME')
        exit 1
    }
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowsEvidence.cs') -ErrorAction Stop | Out-Null
    exit ([SmartPmReadonlyEvidenceProtocolV1]::Run())
}
catch {
    [Console]::Error.WriteLine('NATIVE_EVIDENCE_BOOTSTRAP')
    exit 1
}
