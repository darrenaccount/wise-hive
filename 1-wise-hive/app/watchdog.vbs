' Runs every 2 minutes from Task Scheduler ("Teamwright watchdog"). Starts The Wise Hive in the tray if it isn't
' running or isn't answering, unless you quit it yourself. Window style 0 = no console flash.
' start.ps1 is found next to this file, so the brain folder can live anywhere.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\start.ps1"" -Watchdog", 0, False
