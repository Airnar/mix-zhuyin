; 混打注音 MixZhuyin — add-on installer for PIME.
;
; PIME (https://github.com/EasyIME/PIME) must already be installed with its
; Node.js backend (choose "完整安裝" or tick 小麥注音 in the PIME installer).
; This installer copies MixZhuyin into PIME's node\input_methods folder and
; re-registers PIME's text service so Windows lists the new input method.
;
; Build: windows/build_installer.sh (needs makensis 3.x).

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef PAYLOAD
  !define PAYLOAD "build\MixZhuyin"
!endif
!ifndef OUTFILE
  !define OUTFILE "build\MixZhuyin-${VERSION}-setup.exe"
!endif

!define PRODUCT_NAME "混打注音"
!define IME_DIR "MixZhuyin"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MixZhuyin"
!define PIME_RELEASES "https://github.com/EasyIME/PIME/releases"
!define HOMEPAGE "https://github.com/Airnar/mix-zhuyin"

Name "${PRODUCT_NAME} ${VERSION}"
Caption "${PRODUCT_NAME} ${VERSION} 安裝程式"
OutFile "${OUTFILE}"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show
BrandingText "${PRODUCT_NAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1028 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1028 "FileDescription" "${PRODUCT_NAME} 安裝程式"
VIAddVersionKey /LANG=1028 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1028 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1028 "LegalCopyright" "MIT License; based on McBopomofo"

Var PIMEDIR

!define MUI_ICON "${PAYLOAD}\icon.ico"
!define MUI_UNICON "${PAYLOAD}\icon.ico"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "安裝${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "${PRODUCT_NAME}用注音鍵盤直接打中文和英文，會自動判斷，不用切換。$\r$\n$\r$\n${PRODUCT_NAME}裝在 PIME 輸入法平台裡，安裝前請確認已經裝好 PIME（安裝 PIME 時選「完整安裝」，或勾選「小麥注音」）。$\r$\n$\r$\n安裝過程會暫時關閉 PIME，正在用 PIME 輸入法打字的視窗請先存檔。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "${PRODUCT_NAME}安裝完成"
!define MUI_FINISHPAGE_TEXT "按 Win + 空白鍵，選「${PRODUCT_NAME}」就能開始打字。$\r$\n$\r$\n如果清單裡沒有，請到「設定 → 時間與語言 → 語言與地區 → 中文 (台灣) → 語言選項」，在鍵盤裡新增「${PRODUCT_NAME}」。$\r$\n$\r$\n組字中單按 Shift 可以把那一段中英互換，按 ↓ 選字。"
!define MUI_FINISHPAGE_LINK "${PRODUCT_NAME}網站與說明"
!define MUI_FINISHPAGE_LINK_LOCATION "${HOMEPAGE}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "TradChinese"

; Stops PIME's launcher and its backend processes (same as PIME's installer).
!macro StopLauncher
  ${If} ${FileExists} "$PIMEDIR\PIMELauncher.exe"
    ExecWait '"$PIMEDIR\PIMELauncher.exe" /quit'
    Sleep 800
  ${EndIf}
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "PIMELauncher.exe" /T'
  Pop $0
!macroend

; Starts PIME's launcher as the signed-in user rather than as administrator.
!macro StartLauncher
  ${If} ${FileExists} "$PIMEDIR\PIMELauncher.exe"
    Exec '"$WINDIR\explorer.exe" "$PIMEDIR\PIMELauncher.exe"'
  ${EndIf}
!macroend

; (Re)registers PIME's text service. Registering scans every
; input_methods\*\ime.json, so it picks up added or removed input methods.
; The 32-bit DLL also maintains the per-user profile list, so it goes last.
!macro RegisterPIME ARGS
  ${If} ${RunningX64}
  ${OrIf} ${IsNativeARM64}
    ${DisableX64FSRedirection}
    ${If} ${FileExists} "$PIMEDIR\arm64\PIMETextService.dll"
      ExecWait '"$SYSDIR\regsvr32.exe" /s ${ARGS} "$PIMEDIR\arm64\PIMETextService.dll"'
    ${ElseIf} ${FileExists} "$PIMEDIR\x64\PIMETextService.dll"
      ExecWait '"$SYSDIR\regsvr32.exe" /s ${ARGS} "$PIMEDIR\x64\PIMETextService.dll"'
    ${EndIf}
    ${EnableX64FSRedirection}
  ${EndIf}
  ${If} ${FileExists} "$PIMEDIR\x86\PIMETextService.dll"
    ExecWait '"$SYSDIR\regsvr32.exe" /s ${ARGS} "$PIMEDIR\x86\PIMETextService.dll"'
  ${EndIf}
!macroend

; PIME's installer writes its keys to the native (64-bit) registry view.
!macro UseNativeRegView
  ${If} ${RunningX64}
  ${OrIf} ${IsNativeARM64}
    SetRegView 64
  ${EndIf}
!macroend

Function .onInit
  !insertmacro UseNativeRegView
  ReadRegStr $PIMEDIR HKLM "Software\PIME" ""
  ${If} $PIMEDIR == ""
    StrCpy $PIMEDIR "$PROGRAMFILES32\PIME"
  ${EndIf}
  ${IfNot} ${FileExists} "$PIMEDIR\PIMELauncher.exe"
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "找不到 PIME 輸入法平台。$\r$\n$\r$\n${PRODUCT_NAME}要先安裝 PIME（免費、開源）。安裝 PIME 時請選「完整安裝」，或勾選「小麥注音」元件，裝好後再執行這個安裝程式。$\r$\n$\r$\n要現在開啟 PIME 的下載頁嗎？" /SD IDNO IDNO noOpen
      ExecShell "open" "${PIME_RELEASES}"
    noOpen:
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$PIMEDIR\node\node.exe"
    MessageBox MB_OK|MB_ICONEXCLAMATION "PIME 沒有安裝 Node.js 執行環境，${PRODUCT_NAME}需要它。$\r$\n$\r$\n請重新執行 PIME 安裝程式，選「完整安裝」或勾選「小麥注音」元件，然後再安裝${PRODUCT_NAME}。" /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$PIMEDIR\python\python3\python.exe"
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "PIME 沒有安裝 Python 執行環境，${PRODUCT_NAME}的「偏好設定」和「編輯使用者詞庫」視窗會打不開，但打字不受影響。$\r$\n$\r$\n要繼續安裝嗎？（之後重新執行 PIME 安裝程式並勾選「小麥注音」即可補上。）" /SD IDOK IDOK +2
    Abort
  ${EndIf}
  StrCpy $INSTDIR "$PIMEDIR\node\input_methods\${IME_DIR}"
FunctionEnd

Section "Install"
  SetShellVarContext all
  DetailPrint "PIME 位置：$PIMEDIR"
  !insertmacro StopLauncher

  ; Replace any previous version.
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall-MixZhuyin.exe"

  DetailPrint "向 Windows 註冊輸入法…"
  !insertmacro RegisterPIME ""

  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "MixZhuyin"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "${HOMEPAGE}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall-MixZhuyin.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "PIMEDir" "$PIMEDIR"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1

  !insertmacro StartLauncher
SectionEnd

Function un.onInit
  !insertmacro UseNativeRegView
  ReadRegStr $PIMEDIR HKLM "${UNINST_KEY}" "PIMEDir"
  ${If} $PIMEDIR == ""
    ReadRegStr $PIMEDIR HKLM "Software\PIME" ""
  ${EndIf}
  ${If} $PIMEDIR == ""
    StrCpy $PIMEDIR "$PROGRAMFILES32\PIME"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  !insertmacro StopLauncher

  RMDir /r "$PIMEDIR\node\input_methods\${IME_DIR}"

  ; Unregistering removes all of PIME's profiles and renumbers the per-user
  ; list safely; registering again restores the input methods that remain.
  DetailPrint "更新 Windows 輸入法清單…"
  !insertmacro RegisterPIME "/u"
  !insertmacro RegisterPIME ""

  DeleteRegKey HKLM "${UNINST_KEY}"
  !insertmacro StartLauncher
  DetailPrint "你的使用者詞庫和設定保留在 %APPDATA%\PIME\mixzhuyin。"
SectionEnd
