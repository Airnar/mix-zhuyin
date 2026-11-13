; 混打注音 MixZhuyin — all-in-one installer.
;
; Installs MixZhuyin's own text service (a renamed build of PIME's, see
; windows/pime/UPSTREAM.md), its launcher, Node.js and the input method into
; Program Files\MixZhuyin. It does not need PIME and can sit next to it.
; If the earlier PIME add-on version of MixZhuyin is installed, it is removed
; from PIME first, so Windows lists only one 混打注音.
;
; Build: windows/build_all_in_one.ps1 (Windows; needs makensis 3.x).
; Parts of this script follow PIME's installer/macros.nsh (LGPL 2.0).

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef PAYLOAD
  !define PAYLOAD "build\payload"
!endif
!ifndef OUTFILE
  !define OUTFILE "build\MixZhuyin-${VERSION}-setup.exe"
!endif

!define PRODUCT_NAME "混打注音"
!define PRODUCT_KEY "Software\MixZhuyin"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MixZhuyin"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define LAUNCHER "MixZhuyinLauncher.exe"
!define DLL "MixZhuyinTextService.dll"
!define CLSID "{A64DF4E9-E913-47D2-A89A-CF3134688E0D}"
!define HOMEPAGE "https://github.com/Airnar/mix-zhuyin"
!define IME_ICON "node\input_methods\MixZhuyin\icon.ico"

Name "${PRODUCT_NAME} ${VERSION}"
Caption "${PRODUCT_NAME} ${VERSION} 安裝程式"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\MixZhuyin"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show
BrandingText "${PRODUCT_NAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1028 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1028 "FileDescription" "${PRODUCT_NAME} 安裝程式"
VIAddVersionKey /LANG=1028 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1028 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1028 "LegalCopyright" "MIT (MixZhuyin, McBopomofo); LGPL 2.0 (PIME text service)"

Var ADDON_PIMEDIR

!define MUI_ICON "${PAYLOAD}\${IME_ICON}"
!define MUI_UNICON "${PAYLOAD}\${IME_ICON}"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "安裝${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "${PRODUCT_NAME}用注音鍵盤直接打中文和英文，會自動判斷，不用切換。$\r$\n$\r$\n這個安裝程式已經包含所需的一切，不用另外安裝 PIME。$\r$\n$\r$\n如果你裝過 PIME 外掛版的${PRODUCT_NAME}，安裝程式會先把它從 PIME 移除，你的詞庫和設定會保留下來。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "${PRODUCT_NAME}安裝完成"
!define MUI_FINISHPAGE_TEXT "按 Win + 空白鍵，選「${PRODUCT_NAME}」就能開始打字。$\r$\n$\r$\n如果清單裡沒有，請到「設定 → 時間與語言 → 語言與地區 → 中文 (台灣) → 語言選項」，在鍵盤裡新增「${PRODUCT_NAME}」。$\r$\n$\r$\n已經開著的程式要重新開啟，才會用到新版。"
!define MUI_FINISHPAGE_LINK "${PRODUCT_NAME}網站與說明"
!define MUI_FINISHPAGE_LINK_LOCATION "${HOMEPAGE}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "TradChinese"

; Deletes a file that a running program may have loaded (a DLL in an open
; app, or node.exe). Windows lets us rename such a file, so move it aside and
; delete it at the next restart instead. (PIME's SafeDeleteFile, simplified.)
!macro SafeDelete FILE
  ${If} ${FileExists} "${FILE}"
    ClearErrors
    Delete "${FILE}"
    ${If} ${Errors}
      GetTempFileName $R9 "$INSTDIR"
      Delete $R9
      ClearErrors
      Rename "${FILE}" "$R9.deleted"
      ${IfNot} ${Errors}
        Delete /REBOOTOK "$R9.deleted"
      ${Else}
        Delete /REBOOTOK "${FILE}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro SafeDeleteBinaries
  !insertmacro SafeDelete "$INSTDIR\${LAUNCHER}"
  !insertmacro SafeDelete "$INSTDIR\x86\${DLL}"
  !insertmacro SafeDelete "$INSTDIR\x64\${DLL}"
  !insertmacro SafeDelete "$INSTDIR\arm64\${DLL}"
  !insertmacro SafeDelete "$INSTDIR\arm64\MixZhuyinTextService_arm64.dll"
  !insertmacro SafeDelete "$INSTDIR\arm64\MixZhuyinTextService_x64.dll"
  !insertmacro SafeDelete "$INSTDIR\node\node.exe"
!macroend

; Runs regsvr32 on a DLL. 64-bit DLLs need the 64-bit regsvr32, which a
; 32-bit installer only reaches with file system redirection turned off.
!macro Regsvr32 BITS ARGS DLLPATH
  ${If} ${FileExists} "${DLLPATH}"
    ${If} "${BITS}" == "64"
      ${DisableX64FSRedirection}
      ExecWait '"$SYSDIR\regsvr32.exe" /s ${ARGS} "${DLLPATH}"' $R8
      ${EnableX64FSRedirection}
    ${Else}
      ExecWait '"$SYSDIR\regsvr32.exe" /s ${ARGS} "${DLLPATH}"' $R8
    ${EndIf}
    DetailPrint "regsvr32 ${ARGS} ${DLLPATH}: $R8"
  ${EndIf}
!macroend

; Registers or unregisters MixZhuyin's text service for this machine's
; architecture. The 32-bit DLL also keeps the per-user profile list, so it
; goes last.
!macro RegisterMixZhuyin ARGS
  ${If} ${IsNativeARM64}
    !insertmacro Regsvr32 64 "${ARGS}" "$INSTDIR\arm64\${DLL}"
  ${ElseIf} ${IsNativeAMD64}
    !insertmacro Regsvr32 64 "${ARGS}" "$INSTDIR\x64\${DLL}"
  ${EndIf}
  !insertmacro Regsvr32 32 "${ARGS}" "$INSTDIR\x86\${DLL}"
!macroend

!macro StopLauncher
  ${If} ${FileExists} "$INSTDIR\${LAUNCHER}"
    ExecWait '"$INSTDIR\${LAUNCHER}" /quit'
    Sleep 800
  ${EndIf}
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "${LAUNCHER}" /T'
  Pop $R8
!macroend

; Starts the launcher as the signed-in user rather than as administrator:
; explorer.exe runs programs at the user's own level.
!macro StartLauncher
  ${If} ${FileExists} "$INSTDIR\${LAUNCHER}"
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\${LAUNCHER}"'
  ${EndIf}
!macroend

; Re-registers PIME's own text service so its input methods list matches what
; is installed. Unregistering first renumbers the per-user profile list
; safely; gaps in it crash Windows 11's input switcher.
!macro ReregisterPIME PIMEDIR
  ${If} ${IsNativeARM64}
    !insertmacro Regsvr32 64 "/u" "${PIMEDIR}\arm64\PIMETextService.dll"
    !insertmacro Regsvr32 64 "" "${PIMEDIR}\arm64\PIMETextService.dll"
  ${ElseIf} ${IsNativeAMD64}
    !insertmacro Regsvr32 64 "/u" "${PIMEDIR}\x64\PIMETextService.dll"
    !insertmacro Regsvr32 64 "" "${PIMEDIR}\x64\PIMETextService.dll"
  ${EndIf}
  !insertmacro Regsvr32 32 "/u" "${PIMEDIR}\x86\PIMETextService.dll"
  !insertmacro Regsvr32 32 "" "${PIMEDIR}\x86\PIMETextService.dll"
!macroend

; The installers write their keys to the native (64-bit) registry view.
!macro UseNativeRegView
  ${If} ${RunningX64}
  ${OrIf} ${IsNativeARM64}
    SetRegView 64
  ${EndIf}
!macroend

Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK "${PRODUCT_NAME}需要 Windows 10 或更新版本。" /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
  ${AndIfNot} ${IsNativeARM64}
    MessageBox MB_ICONSTOP|MB_OK "${PRODUCT_NAME}需要 64 位元的 Windows（x64 或 ARM64）。" /SD IDOK
    Abort
  ${EndIf}
  !insertmacro UseNativeRegView

  ; The PIME add-on version wrote the same uninstall key, with PIMEDir set.
  ReadRegStr $ADDON_PIMEDIR HKLM "${UNINST_KEY}" "PIMEDir"
FunctionEnd

Section "Install"
  SetShellVarContext all

  ${If} $ADDON_PIMEDIR != ""
  ${AndIf} ${FileExists} "$ADDON_PIMEDIR\node\input_methods\MixZhuyin\ime.json"
    DetailPrint "移除 PIME 外掛版的${PRODUCT_NAME}（$ADDON_PIMEDIR）…"
    ${If} ${FileExists} "$ADDON_PIMEDIR\PIMELauncher.exe"
      ExecWait '"$ADDON_PIMEDIR\PIMELauncher.exe" /quit'
      Sleep 800
    ${EndIf}
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "PIMELauncher.exe" /T'
    Pop $R8
    RMDir /r "$ADDON_PIMEDIR\node\input_methods\MixZhuyin"
    !insertmacro ReregisterPIME "$ADDON_PIMEDIR"
    ${If} ${FileExists} "$ADDON_PIMEDIR\PIMELauncher.exe"
      Exec '"$WINDIR\explorer.exe" "$ADDON_PIMEDIR\PIMELauncher.exe"'
    ${EndIf}
    DeleteRegKey HKLM "${UNINST_KEY}"
  ${EndIf}

  ; Replace an earlier all-in-one version.
  !insertmacro StopLauncher
  !insertmacro RegisterMixZhuyin "/u"
  !insertmacro SafeDeleteBinaries
  RMDir /r "$INSTDIR\node"

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  DetailPrint "向 Windows 註冊輸入法…"
  !insertmacro RegisterMixZhuyin ""

  WriteRegStr HKLM "${RUN_KEY}" "MixZhuyinLauncher" '"$INSTDIR\${LAUNCHER}"'
  WriteRegStr HKLM "${PRODUCT_KEY}" "" "$INSTDIR"
  WriteRegStr HKLM "${PRODUCT_KEY}" "Version" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "MixZhuyin"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "${HOMEPAGE}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${IME_ICON}"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1

  !insertmacro StartLauncher
SectionEnd

Function un.onInit
  !insertmacro UseNativeRegView
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  !insertmacro StopLauncher

  DetailPrint "從 Windows 移除輸入法…"
  !insertmacro RegisterMixZhuyin "/u"

  ; regsvr32 /u removes the profiles and categories; drop what TSF may keep
  ; of the empty TIP key. (The per-user list is the DLL's job, see above.)
  DeleteRegKey HKLM "SOFTWARE\Microsoft\CTF\TIP\${CLSID}"
  DeleteRegValue HKLM "${RUN_KEY}" "MixZhuyinLauncher"
  DeleteRegKey HKLM "${PRODUCT_KEY}"
  DeleteRegKey HKLM "${UNINST_KEY}"

  !insertmacro SafeDeleteBinaries
  RMDir /r /REBOOTOK "$INSTDIR\node"
  RMDir /r /REBOOTOK "$INSTDIR\x86"
  RMDir /r /REBOOTOK "$INSTDIR\x64"
  RMDir /r /REBOOTOK "$INSTDIR\arm64"
  RMDir /r /REBOOTOK "$INSTDIR\licenses"
  Delete "$INSTDIR\backends.json"
  Delete "$INSTDIR\version.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /REBOOTOK "$INSTDIR"
  DetailPrint "你的使用者詞庫和設定保留在 %APPDATA%\MixZhuyin。"
SectionEnd
