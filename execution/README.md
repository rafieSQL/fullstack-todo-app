# Layer 3: Execution (Deterministic Scripts)

This directory contains deterministic helper scripts, migrations, refactoring tools, and automated task runners called during directive execution.

## Guidelines

- Scripts here should be deterministic and idempotent where possible.
- Environment variables must be loaded securely from `.env` (never hardcoded).
- Use proper error codes and clean stdout/stderr for Agent parsing.
