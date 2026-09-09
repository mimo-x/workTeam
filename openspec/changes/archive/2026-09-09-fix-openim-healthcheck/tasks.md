## 1. Health check implementation

- [x] 1.1 Add reproducible evidence and a fixture for the OpenIM v3.8 `mage check`/missing-Go failure; verify secrets are not printed
- [x] 1.2 Update `deploy.sh` to use real OpenIM API authentication probes with bounded retry and actionable failure categories; verify malformed token and unreachable service paths
- [x] 1.3 Make the deployment-side health status consistent with API availability while preserving existing OpenIM data and configuration; verify repeat deployment behavior

## 2. Acceptance and documentation

- [x] 2.1 Add BDD acceptance cases for missing Go, API success, API unreachable, and authentication failure; verify the cases run without a live production dependency
- [x] 2.2 Update deployment documentation to explain that `deploy.sh` is the only deployment entry point and reports real API readiness

## 3. Validation

- [x] 3.1 Run deployment script syntax/static checks, OpenSpec strict validation, backend tests/build, desktop tests/build, lint, and typecheck; verify all checks pass
