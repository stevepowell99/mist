# A suggester's first typing is lost in about one stress run in seven

- **Seen:** 17 November 2026, `scripts/stress-live-suggest.py` on a Drive doc, 2 failures in about 14 runs
- **Symptom:** the first visitor (Ana) types ` [A<stamp>]` after the other two have joined; the text is in nobody's copy, hers included. The other two visitors' typing arrives.
- **Ruled out**
  - Drive overwriting the room: the sync log holds no `adopt-drive` at those times
  - Typing as such: `_tmp/first_type.py` typed as the first visitor 10 times out of 10
- **Not reproduced** in 8 further runs with the instrumentation in place
- **Instrumentation left in the script:** on a miss it prints focus, cursor, active element before and after, and saves `_tmp/a_lost.png`
- **Suspects, untested**
  - keyboard focus taken from the editor when a second visitor joins (a panel or avatar re-render)
  - the test file itself: 56,000 characters, one 1,500-character line, broken markup from earlier runs, and Steve's own tab in the room
- **Next:** rerun on a fresh Drive file; if it recurs, read the printed focus state
