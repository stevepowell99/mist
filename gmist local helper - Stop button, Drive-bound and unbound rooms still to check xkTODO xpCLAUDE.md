The local gmist helper (commit `ac5fc6a`, panel: spark button or Ctrl/Cmd+Alt+H) was proved only in local-fs mode.

- Still to check, in the running local gmist:
    - The Stop button cancels a running reply. The session was about to test it when it ended; the "?" Help button covered Send/Stop, fixed in the commit after `3ef6572` (padding on the button row), which is committed but not pushed.
    - Drive-bound and unbound rooms: they gain only an optional navbar prop that they do not pass. Confirm the navbar renders as before, without the helper button.
- Push the unpushed padding commit once the Stop check passes (`git log origin/main..` shows it).
- Related: the request to fold SVG, mermaid and similar code blocks by default belongs to the Live view session.
