$ErrorActionPreference = 'Stop'
try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) {
        [Console]::Error.WriteLine('WINDOWS_INPUT_RUNTIME')
        exit 1
    }
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowsReadonlyInteractive.cs') -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll') -ErrorAction Stop | Out-Null
    exit ([SmartPmWindowsReadonlyInteractiveV1]::Run())
}
catch {
    [Console]::Error.WriteLine('WINDOWS_INPUT_BOOTSTRAP')
    exit 1
}
