# Slow reconnect after a reload, seen while testing sign-in-free access, 17 November 2026

Seen in Steve's Chrome on the deployed worker, on a Drive-bound doc opened without sign-in. Not confirmed as a defect: six scripted reloads in a shared room each showed text within 1.5 seconds.

- **Slow reconnect after a reload.** The page showed "Connecting" or "Closing" for 10 to 17 seconds before the text appeared, three times out of about ten reloads. Two gmist tabs were open for one of them. Check whether the old socket's close delays the new connection.
