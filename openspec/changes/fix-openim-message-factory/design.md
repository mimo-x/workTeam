## Context

`OpenImTransport.sendText` currently assumes the native Electron SDK always returns a `MessageItem`. In the observed desktop run, `createTextMessage` returned `data: ""`; writing `data.ex` caused the visible error before `sendMessage` ran.

## Approach

- Add a small pure message-construction helper that accepts the session type, text, @ IDs, and platform ID.
- Use the native factory result when it is a non-null object; otherwise use the helper's minimal `MessageItem` shape.
- Set metadata on the normalized object, then call the existing `sendMessage` path.
- Represent mention candidates as Agent or Human contacts. Derive human mention text from `handle` (falling back to ID), while keeping `targetAgentIds` limited to Agent candidates.

## Compatibility

No backend or OpenIM deployment changes are required. The fallback is only used for malformed native factory results and keeps the existing transport and metadata contract.
