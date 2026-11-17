# A suggestion vanishes after a reload in a Drive doc

Found 17 November 2026 while testing sign-in-free access. Blocks giving colleagues a link to a Drive doc for suggestions.

## What happens

- Type a suggestion (`{++ text++}`) at the end of the last line, wait for "Synced" (Drive holds it).
- Reload the page. For about three seconds the suggestion is there, in the editor and in the agent (`GET ?source`).
- Then it is deleted, the badge goes "Saving…", and 20 seconds later the stripped text is saved to Drive.
- Reproduced six times out of six, with the mouse and focus moved away first.

## Where

- Room `e27s33t7`, file `gmist anonymous access test.md` (id `1k9YFgiuwDy5OisTFXujiFehRYIVv7f_q`) in the gmist examples folder, shared anyone-with-link as Editor.
- Steve's Chrome (Claude tab group), visitor not signed in, link role edit, shared mode Suggesting, one comment thread with a reply in the `mist:` block.

## Ruled out

- The agent: `replaceBodyFromText` is its only body write, it always logs `adopt-drive`, and the sync log shows only `open` and `save`.
- A plain shared room in headless Playwright (`_tmp/repro_suggest.py`): the suggestion survives a reload, with and without a comment.

## Not yet separated

- Drive-bound versus unbound, in the same browser.
- Anonymous versus signed in.
- Steve's Chrome versus a clean browser on the Drive doc (the Chrome tool hides the room key, so Playwright could not open that room).

## Next

- Reproduce under `npm run dev` with a Drive-bound doc, hook `view.dispatch` in the main world and read the stack of the deleting transaction.
- Also seen: after a reload the page can sit on "Connecting" or "Closing" for 10 seconds or more before the text appears.
- Also seen: with a suggest-only role, End then Enter in the editor put a bare newline into the text, not a `{++ ++}` suggestion.
