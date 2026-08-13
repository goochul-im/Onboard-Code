# Workspace scenario manifest validation

The canonical manifest is `apps/desktop/src-tauri/tests/fixtures/manifest.yaml`.
It defines deterministic inputs and expected outcomes; the scenario-named evidence
paths are checked-in scenario receipts. They record the fixed fixture and symbol
mapping without claiming that the future, owning scenario execution has run.

Validation performed for this artifact:

- YAML parses successfully.
- The fixture catalog fixes a revision for each fixture ID.
- The scenario catalog contains exactly the fourteen required stable IDs.
- Every scenario has a fixture ID, repository revision, named symbol, setup,
  fault checkpoint, persisted assertions, visible assertions, and an evidence
  filename below `artifacts/verification/`.
- The manifest validation checks these requirements without claiming execution
  evidence for the scenarios themselves; each named receipt is a canonical
  mapping record for its owning scenario execution.
