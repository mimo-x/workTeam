## Context

`OpenImClient` uses `OPENIM_API_URL` for server-to-server REST calls. The same value is currently returned by `/v1/im/session`, although desktop clients run outside the Docker network.

## Approach

- Add `OPENIM_PUBLIC_API_URL` to the validated app config.
- Return `config.OPENIM_PUBLIC_API_URL || config.OPENIM_API_URL` from the session endpoint.
- Have `deploy.sh` generate `OPENIM_PUBLIC_API_URL=http://${SERVER_IP}:10002` and preserve `OPENIM_API_URL=http://openim-server:10002`.

## Rollout

After pulling the change, run `bash deploy.sh` once. Existing `.env.backend.local` files are preserved by the script, so the script must update the public key explicitly on rerun.
