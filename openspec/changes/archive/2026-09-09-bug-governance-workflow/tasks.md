## 1. Bug record and project rules

- [x] 1.1 Add Bug record template and a representative incident record; verify required fields and BDD content
- [x] 1.2 Update `AGENTS.md` with mandatory Bug, Case, OpenSpec, and verification rules; verify repository guidance includes all rules

## 2. Workflow guidance

- [x] 2.1 Add the `bug-management` Skill with record → reproduce → propose → implement → verify steps; verify the Skill file is loadable

## 3. Automated gates

- [x] 3.1 Add a dependency-free Bug record checker and `validate:bugs` command; verify valid and incomplete records produce pass/fail results
- [x] 3.2 Add a versioned pre-commit Hook invoking the checker; verify the Hook is executable and does not scan non-Bug changes

## 4. Validation

- [x] 4.1 Add BDD acceptance coverage for missing record fields, missing test references, and complete records; verify the checker reports actionable errors
- [x] 4.2 Run OpenSpec strict validation, Bug checker, tests, lint, typecheck, and build; verify all required checks pass
