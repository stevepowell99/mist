# Comment Delete and Resolve are open to everyone

- Steve, 20 November 2026, on the shared Pilots agenda deck: "random ppl can/cannot delete comments".
- Cause, as far as the code shows: `ThreadPanel` draws Reply, Resolve and Delete on every thread for every viewer, without checking role or author.
  - A suggest-link visitor can delete anyone's comment.
  - The editor toolbar's Delete on a comment (`cm-selection-toolbar.ts`) does not check either.
- The "cannot" half is not explained yet: a Delete that does nothing may be a thread whose record does not match its text. Reproduce before fixing.
- To decide with Steve: who may delete or resolve. A likely rule: the comment's author and edit-role holders only.
