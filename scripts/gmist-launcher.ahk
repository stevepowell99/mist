; gmist launcher (AutoHotkey v2)
;
; A Spotlight-style global hotkey for gmist. It opens the bare /go launcher page,
; whose only content is the quick-open palette: type a Drive markdown file's
; name, Enter opens it in gmist. Auth and the Drive lookup happen in the browser
; under your existing gmist sign-in, so this script holds no credentials.
;
; Setup: install AutoHotkey v2, then run this file (or drop a shortcut to it in
; shell:startup so the hotkey is always live). Adjust URL and the hotkey below.
;
; Hotkey: Ctrl+Alt+O (O for Open). Change the line at the bottom to taste.

#Requires AutoHotkey v2.0

GmistUrl := "https://mist.broad-smoke-cc64.workers.dev/go"

OpenGmist(*) {
    Run(GmistUrl)
}

^!o::OpenGmist()
