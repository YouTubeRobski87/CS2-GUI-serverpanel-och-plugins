' Gamla Skolan Panel - startar panelen som program (utan svart fonster).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
On Error Resume Next
If Not fso.FolderExists(dir & "\panel-data") Then fso.CreateFolder(dir & "\panel-data")
Set f = fso.OpenTextFile(dir & "\panel-data\tray.log", 8, True)
f.WriteLine Now & "  Genvagen startad"
f.Close
On Error GoTo 0
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\panel-tray.ps1""", 0, False
