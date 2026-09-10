# openim-public-endpoint Specification

## ADDED Requirements

### Requirement: OpenIM session returns a client-reachable API address

业务 API SHALL keep the internal OpenIM API URL for server-side calls and return `OPENIM_PUBLIC_API_URL` to desktop clients when it is configured. If the public value is empty, it SHALL fall back to the internal URL for local deployments.

#### Scenario: Docker internal and public addresses differ

- **GIVEN** `OPENIM_API_URL` is a container hostname and `OPENIM_PUBLIC_API_URL` is a client-reachable URL
- **WHEN** an authenticated client requests `/v1/im/session`
- **THEN** the response `apiAddr` is the public URL while server-side OpenIM calls still use the internal URL

### Requirement: One-click deployment configures the public API address

部署脚本 SHALL write `OPENIM_PUBLIC_API_URL` using the detected server public IP and OpenIM API port while retaining the internal `OPENIM_API_URL`.

#### Scenario: Initial backend environment generation

- **GIVEN** `.env.backend.local` does not exist
- **WHEN** `bash deploy.sh` generates backend configuration
- **THEN** it writes distinct internal and public OpenIM API URLs
