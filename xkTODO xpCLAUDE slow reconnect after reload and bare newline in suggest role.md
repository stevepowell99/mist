# Two things seen while testing sign-in-free access, 17 November 2026

Both seen in Steve's Chrome on the deployed worker, on a Drive-bound doc opened without sign-in. Neither is confirmed as a defect.

- **Slow reconnect after a reload.** The page showed "Connecting" or "Closing" for 10 to 17 seconds before the text appeared, three times out of about ten reloads. Two gmist tabs were open for one of them. Check whether the old socket's close delays the new connection.
- **Bare newline from a suggest-only visitor.** With the file shared as Commenter, clicking a comment card, then End, then Enter put a plain newline into the text where a `{++ ++}` suggestion was expected. Seen once; reproduce before fixing.
