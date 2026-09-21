; Lauda's own steps in the Windows installer; electron-builder includes this
; file from build/.

; The shortcuts' description, which Windows shows when the pointer rests on
; one, in the installer's language. electron-builder writes package.json's
; description, in English, whatever language the installer speaks. The
; strings are the catalog's ("A Markdown editor with a live, side-by-side preview" in
; resources/locales/app.json), and test/build/installer.test.ts keeps them so.
LangString laudaDescription 1033 "A Markdown editor with a live, side-by-side preview"
LangString laudaDescription 1046 "Um editor de Markdown com visualização ao vivo, lado a lado"
LangString laudaDescription 1031 "Ein Markdown-Editor mit Live-Vorschau daneben"
LangString laudaDescription 3082 "Un editor de Markdown con vista previa en vivo, lado a lado"
LangString laudaDescription 1036 "Un éditeur Markdown avec un aperçu en direct, côte à côte"
LangString laudaDescription 1041 "ライブプレビューを並べて表示する Markdown エディタ"
LangString laudaDescription 2052 "带并排实时预览的 Markdown 编辑器"

!macro customInstall
  ; The shortcuts electron-builder has just made, made again with the
  ; description in the installer's language. Shortcuts kept from an earlier
  ; installation stay as the reader left them.
  ${if} $keepShortcuts == "false"
    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "$(laudaDescription)"
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
    ${if} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "$(laudaDescription)"
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}
  ${endIf}
!macroend
