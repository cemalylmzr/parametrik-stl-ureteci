Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appScript = fso.BuildPath(scriptDir, "app.mjs")

nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then
  nodeExe = "node.exe"
End If

cmd = """" & nodeExe & """ """ & appScript & """"
' 0 = Pencereyi gizle (siyah CMD ekranı açılmaz), False = bekleme
shell.Run cmd, 0, False
