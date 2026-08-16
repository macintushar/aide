# @workspace/contracts

Zod schemas and inferred types for every Aide wire value: commands, snapshots, `AideEvent`, `Part`, and configuration.

`apps/web` and `apps/server` depend on this package. The UI never imports a harness SDK. Adapters are the only code allowed to do that.

## Freeze policy

After Wave 0 merges, this package is **append-only**.

- Add a new schema or optional field in a dedicated contracts-only PR.
- Do not rename, remove, or change the meaning of an exported schema without that dedicated PR, one integrator, and a note to every active track.
- A later rename of an exported schema name must show up as a visible diff in `src/schema-surface.test.ts`. Do not update that snapshot as a drive-by in an unrelated change.

This rule is why the rest of the build can fan out.
