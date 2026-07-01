@echo off
setlocal
cd /d "%~dp0"
echo [ %date% %time% ] Starting CUB Data Sync... >> sync_log.txt
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync_to_gas.ps1" >> sync_log.txt 2>&1
echo [ %date% %time% ] Sync Process Finished. >> sync_log.txt
echo ------------------------------------------ >> sync_log.txt
exit