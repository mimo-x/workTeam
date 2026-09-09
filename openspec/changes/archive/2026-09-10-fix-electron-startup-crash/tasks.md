## 1. Reproduction and diagnosis

- [x] 1.1 Capture reproducible crash evidence for bare Electron and the full app; verify version, signal, and window count
- [x] 1.2 Isolate native SDK initialization and startup environment contributors; verify the smallest failing path

## 2. Fix and acceptance

- [x] 2.1 Apply the smallest compatible startup fix and add a regression check for a visible window; verify macOS launch remains stable
- [x] 2.2 Add BDD coverage for successful startup and diagnosable startup failure; verify no unowned background process remains

## 3. Validation

- [x] 3.1 Run desktop tests, lint, typecheck, build, and OpenSpec validation; verify all pass
