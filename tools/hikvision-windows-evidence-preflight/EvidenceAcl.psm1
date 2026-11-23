Set-StrictMode -Version 2.0

function New-HkAclResult {
    param([bool] $Valid)
    $code = 'ACL_INVALID'
    if ($Valid) { $code = 'OK' }
    return [pscustomobject]@{ Valid = $Valid; Code = $code }
}

function Read-HkNoteRecord {
    param([object] $Value, [string[]] $Names)
    if ($null -eq $Value -or $Value -isnot [System.Management.Automation.PSCustomObject]) {
        return $null
    }
    $properties = @($Value.PSObject.Properties)
    if ($properties.Count -ne $Names.Count) { return $null }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($property in $properties) {
        if ($property.MemberType -ne [System.Management.Automation.PSMemberTypes]::NoteProperty -or
            $Names -cnotcontains $property.Name -or -not $seen.Add($property.Name)) {
            return $null
        }
    }
    # Read values only after every member has been proved to be a NoteProperty.
    # ScriptProperty and AliasProperty values are never evaluated.
    $record = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::Ordinal)
    foreach ($property in $properties) {
        $record.Add($property.Name, $property.Value)
    }
    return ,$record
}

function Test-HkSupportedUserSid {
    param([object] $Value)
    if ($Value -isnot [string] -or $Value.Length -gt 64) { return $false }
    if (-not [regex]::IsMatch($Value, '\AS-1-(?:5-21|12-1)-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})-(?:0|[1-9][0-9]{0,9})\z')) {
        return $false
    }
    $parts = $Value.Split('-')
    for ($index = 4; $index -lt 8; $index++) {
        [uint32] $number = 0
        if (-not [uint32]::TryParse($parts[$index], [ref] $number)) { return $false }
    }
    return $true
}

function Test-HkInteger {
    param([object] $Value)
    return ($Value -is [sbyte] -or $Value -is [byte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64] -or $Value -is [uint64])
}

function Test-HkAclPolicy {
    param([object] $Snapshot, [object] $CurrentUserSid, [object] $Kind)
    try {
        if (-not (Test-HkSupportedUserSid $CurrentUserSid) -or
            $Kind -isnot [string] -or ($Kind -cne 'Directory' -and $Kind -cne 'File')) {
            return (New-HkAclResult $false)
        }
        $record = Read-HkNoteRecord $Snapshot @(
            'OwnerSid', 'DaclPresent', 'DaclProtected', 'Canonical', 'ReparsePoint', 'Rules'
        )
        if ($null -eq $record -or $record['OwnerSid'] -isnot [string] -or
            $record['OwnerSid'] -cne $CurrentUserSid) {
            return (New-HkAclResult $false)
        }
        foreach ($name in @('DaclPresent', 'DaclProtected', 'Canonical', 'ReparsePoint')) {
            if ($record[$name] -isnot [bool]) { return (New-HkAclResult $false) }
        }
        $directory = $Kind -ceq 'Directory'
        if (-not $record['DaclPresent'] -or -not $record['Canonical'] -or
            $record['ReparsePoint'] -or $record['DaclProtected'] -ne $directory -or
            $record['Rules'] -isnot [object[]] -or $record['Rules'].Count -ne 2) {
            return (New-HkAclResult $false)
        }
        $seenSids = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        foreach ($value in $record['Rules']) {
            $rule = Read-HkNoteRecord $value @(
                'Sid', 'Type', 'Rights', 'IsInherited', 'InheritanceFlags', 'PropagationFlags'
            )
            if ($null -eq $rule -or $rule['Sid'] -isnot [string] -or
                ($rule['Sid'] -cne $CurrentUserSid -and $rule['Sid'] -cne 'S-1-5-18') -or
                -not $seenSids.Add($rule['Sid']) -or
                $rule['Type'] -isnot [string] -or $rule['Type'] -cne 'Allow' -or
                -not (Test-HkInteger $rule['Rights']) -or $rule['Rights'] -ne 2032127 -or
                $rule['IsInherited'] -isnot [bool] -or $rule['IsInherited'] -ne (-not $directory) -or
                -not (Test-HkInteger $rule['InheritanceFlags']) -or
                -not (Test-HkInteger $rule['PropagationFlags']) -or
                $rule['PropagationFlags'] -ne 0) {
                return (New-HkAclResult $false)
            }
            $expectedInheritance = 0
            if ($directory) { $expectedInheritance = 3 }
            if ($rule['InheritanceFlags'] -ne $expectedInheritance) { return (New-HkAclResult $false) }
        }
        return (New-HkAclResult $true)
    }
    catch {
        return (New-HkAclResult $false)
    }
}

Export-ModuleMember -Function Test-HkAclPolicy
