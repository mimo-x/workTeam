## 1. Implementation

- [x] 1.1 Add bounded OpenIM connection readiness probing before credential requests; verify restarting services are retried
- [x] 1.2 Make curl/JSON parsing silent on empty responses and preserve actionable final diagnostics; verify no JSONDecodeError traceback is printed

## 2. Acceptance

- [x] 2.1 Add BDD/static acceptance cases for reset connection, empty response, eventual success, and retry exhaustion; verify cases run without production access
- [x] 2.2 Run shell syntax, deployment tests, OpenSpec validation, and existing project checks; verify all pass
