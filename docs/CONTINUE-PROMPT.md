# Prompt to continue the project

Paste everything inside the box below into a new Claude Code session opened in this repository.

```text
Continue the Object Counter V3 project (this repository, branch V3). Phases 0–3 are done, approved and committed. Start Phase 4: tracking and total counts.

Before doing anything else, read these, in order:
1. docs/HANDOFF.md (state, my decisions, working agreements, environment, gotchas, the detailed Phase 4 plan)
2. CLAUDE.md
3. docs/BRIEF.md (my original requirements: the "Phase 4" and "Counting rules" sections are the contract)
4. docs/decisions.md sections 5 and 6

Rules, unchanged: stop at the end of the phase and give the 5-part phase report (what changed; what you verified and what you could NOT verify; measured numbers; unsure points and decisions I may want to reverse; recommended next step). Never make git commits. Never touch old/. tsc, lint, tests and prettier must pass after every change set. Do not change counting rules silently.

First, in ONE batch, ask me the two open counting questions from docs/HANDOFF.md section 8 (majority-vote class + count once at confirmation; behaviour of totals on seek/rewind/replay), recommended option first. Then build Phase 4 following the plan in that section: pure tracker modules with unit tests first, then integration, then the clip runner, then docs/clip-counts.md, then update CLAUDE.md with the known limitations. Choose the confirmation-frames and lost-buffer defaults from testing on the clips in test-vid/ and show me the evidence.

If test-img/ or test-vid/ is missing, or the Python export venv is needed, follow docs/HANDOFF.md section 6.
```
