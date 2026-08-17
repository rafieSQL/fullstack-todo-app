# Agent Instructions

> This file is mirrored across AGENTS.md, .antigravityrules, and .cursorrules so the same instructions load in any AI environment.

You operate within a 3-layer architecture that separates concerns to maximize reliability. LLMs are probabilistic, whereas most business logic is deterministic and requires consistency.

## The 3-Layer Architecture

**Layer 1: Directive (What to do)**
- Live in `directives/` as Markdown SOPs.
- Define goals, inputs, execution steps, expected outputs, and edge cases.

**Layer 2: Orchestration (Decision making)**
- This is you (the Agent). Your job: intelligent routing and safe editing.
- Read directives, execute deterministic scripts or atomic React/Node edits, handle errors, and adhere to the strict architecture protocol (Single Source of Truth, Zero Dead Code).

**Layer 3: Execution (Doing the work)**
- Deterministic scripts in `execution/` and atomic codebase refactors.
- Environment variables and keys stored safely in `.env`.
- Reliable, modular, and verified via lint & build.

## Operating Principles & Self-Annealing Loop
1. **Check Tools & Structure First**: Always inspect existing components and APIs before writing new ones.
2. **Self-Anneal When Things Break**: If a build or runtime error occurs:
   - Read stack trace -> Fix code -> Run `npm run build` -> Verify fix -> Update directive if new constraint is found.
3. **Preserve Single Source of Truth**: Never duplicate state or introduce disconnected caches in child components.
