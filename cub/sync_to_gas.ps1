# ============================================================
# CUB Financial Data Sync Script (Full Overwrite Mode)
# ============================================================
# Requirements: 32-bit PowerShell (SysWOW64)
# ============================================================

$OutputEncoding = [System.Text.Encoding]::UTF8

# --- Load Config ---
$configFile = "$PSScriptRoot\config.json"
if (-not (Test-Path $configFile)) {
    Write-Host "Error: config.json not found!" -ForegroundColor Red
    return
}
$config = Get-Content $configFile | ConvertFrom-Json
$GAS_URL = $config.ApiUrl
$API_KEY = $config.ApiKey
$BRANCH  = $config.BranchName
$DB_PATH = if ($config.DbPath) { $config.DbPath } else { "$PSScriptRoot\CUB.MDB" }

# --- DB Connection ---
$connString = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$DB_PATH"
$conn = New-Object System.Data.OleDb.OleDbConnection($connString)

try {
    Write-Host "Connecting to DB: $DB_PATH ..."
    $conn.Open()
    
    $cmd = $conn.CreateCommand()
    # SQL: ACCNO, ACCNM, PSCD, Stock, Loan, Reserve (Exclude member IDs starting with 'T')
    $cmd.CommandText = "SELECT ACCNO, ACCNM, PSCD, (PRESTK + SSAV) AS Stock, (PREBO - LNMNY) AS Loan, OVFO AS Reserve FROM [SER] WHERE NOT (ACCNO LIKE 'T%')"
    
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    $adapter.Fill($dt) | Out-Null
    
    $syncData = @()
    foreach ($row in $dt.Rows) {
        $accNo = if ($row.ACCNO -is [System.DBNull]) { "" } else { $row.ACCNO.ToString().Trim() }
        if (-not $accNo) { continue } 

        $syncData += @{
            num     = $accNo
            name    = if ($row.ACCNM -is [System.DBNull]) { "" } else { $row.ACCNM.ToString().Trim() }
            idCard  = if ($row.PSCD -is [System.DBNull]) { "" } else { 
                $rawId = $row.PSCD.ToString().Trim()
                if ($rawId.Length -gt 4) { $rawId.Substring($rawId.Length - 4) } else { $rawId }
            }
            stock   = if ($row.Stock -is [System.DBNull]) { 0 } else { [System.Math]::Round([double]$row.Stock, 0) }
            loan    = if ($row.Loan -is [System.DBNull]) { 0 } else { [System.Math]::Round([double]$row.Loan, 0) }
            reserve = if ($row.Reserve -is [System.DBNull]) { 0 } else { [System.Math]::Round([double]$row.Reserve, 0) }
        }
    }

    if ($syncData.Count -eq 0) {
        Write-Host "Warning: No data found." -ForegroundColor Yellow
    } else {
        $totalCount = $syncData.Count
        Write-Host "Found $totalCount records. Starting sync..." -ForegroundColor Cyan
        
        $payload = @{
            action = "syncFinancialData"
            token  = $API_KEY
            data   = $syncData
            branch = $BRANCH 
        } | ConvertTo-Json -Depth 5 -Compress

        try {
            Write-Host "Uploading to Google Sheets..."
            $maxRetries = 3
            $retryCount = 0
            $success = $false
            
            while (-not $success -and $retryCount -lt $maxRetries) {
                try {
                    $response = Invoke-RestMethod -Uri $GAS_URL -Method Post -Body $payload -ContentType "application/json; charset=utf-8" -TimeoutSec 300
                    if ($response.success) {
                        Write-Host "Sync OK: $($response.data)" -ForegroundColor Green
                        $success = $true
                    } else {
                        Write-Host "Sync Failed: $($response.error). Retrying ($($retryCount + 1)/$maxRetries)..." -ForegroundColor Yellow
                        $retryCount++
                        Start-Sleep -Seconds 2
                    }
                } catch {
                    Write-Host "Attempt $($retryCount + 1) failed: $($_.Exception.Message). Retrying..." -ForegroundColor Yellow
                    $retryCount++
                    Start-Sleep -Seconds 5
                }
            }

            if (-not $success) {
                Write-Host "Failed after $maxRetries attempts." -ForegroundColor Red
            }
        } catch {
            Write-Host "Unexpected Error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "Critical Error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($conn.State -eq 'Open') { $conn.Close() }
    Write-Host "Finished."
}
