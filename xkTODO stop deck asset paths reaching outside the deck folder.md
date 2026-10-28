# Stop deck asset paths reaching outside the deck folder

Found 28 October 2026 while scoping the asset token (commit `ac4d753`).

`/drive/asset` resolves a deck's relative path by walking up from the deck's folder and checks only the deck's own Drive sharing. A signed-in user who can open one deck can therefore ask for `../` paths and read files above or beside that deck's folder, which that user's own sharing might not grant.

Fix: after resolving a path to a file id, check the requesting user's access to that file (`canAccessFile` with their email), or refuse any path that resolves outside the deck's folder tree and the shared library folder. Check that decks which legitimately use `../img/` paths still load.
