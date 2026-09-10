## 1. Backend configuration

- [x] Add `OPENIM_PUBLIC_API_URL` and return it from `/v1/im/session` with internal fallback.
- [x] Update `deploy.sh` to generate and refresh the public URL.
- [x] Add API and deployment regression Cases.

## 2. Verification

- [x] Run bug governance, backend tests/build, desktop tests, lint, typecheck, build, and strict OpenSpec validation.
- [ ] Ask the user to rerun `bash deploy.sh` and then repeat the real group chat UI workflow.
