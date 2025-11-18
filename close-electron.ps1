# PowerShell script to close Electron processes
Get-Process | Where-Object {$_.ProcessName -like "*electron*"} | Stop-Process -Force
Write-Host "Closed all Electron processes"

