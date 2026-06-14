!include LogicLib.nsh

!macro closeDanmakuCompanion
  DetailPrint "Closing stale Danmaku Companion processes."
  nsExec::ExecToLog '"$SYSDIR\cmd.exe" /C taskkill /F /IM "Danmaku Companion.exe" /FI "USERNAME eq %USERNAME%"'
  Sleep 700
!macroend

!macro moveStaleDanmakuInstall
  ${if} ${FileExists} "$INSTDIR\*.*"
    DetailPrint "Moving stale Danmaku Companion installation directory aside."
    RMDir /r "$INSTDIR.old"
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR.old"
    ${if} ${errors}
      DetailPrint "Could not move stale Danmaku Companion installation directory; continuing with overwrite."
      ClearErrors
    ${endif}
  ${endif}
!macroend

!macro customCheckAppRunning
  !insertmacro closeDanmakuCompanion
!macroend

!macro customInit
  !insertmacro closeDanmakuCompanion
!macroend

!macro customUnInstallCheck
  ${if} ${errors}
    DetailPrint "Old Danmaku Companion uninstaller could not be launched; falling back to stale directory cleanup."
    !insertmacro moveStaleDanmakuInstall
    ClearErrors
  ${elseif} $R0 != 0
    DetailPrint "Old Danmaku Companion uninstaller returned $R0; falling back to stale directory cleanup."
    !insertmacro moveStaleDanmakuInstall
    ClearErrors
  ${endif}
!macroend
