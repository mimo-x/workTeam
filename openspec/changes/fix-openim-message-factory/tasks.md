## 1. Message construction

- [x] Add a pure fallback text-message builder and normalize native factory results before metadata assignment.
- [x] Add regression coverage for an empty native factory result and metadata preservation.

## 2. Group mentions

- [x] Include group friends in mention candidates and OpenIM at-target IDs while keeping Agent routing separate.
- [x] Add a BDD-style regression Case for inviting a friend and sending an @ message.

## 3. Verification

- [x] Run bug governance, targeted tests, lint, typecheck, build, and strict OpenSpec validation.
- [ ] Re-run both workflows in the Electron desktop UI and record results in the Bug record.
