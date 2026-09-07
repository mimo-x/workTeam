import type { CodexDesktopApi } from "../../shared/codex";
import type { AgentTeamApi, ImDesktopApi } from "../../shared/agent-team";
import type { BackendDesktopApi } from "../../shared/backend";

declare global {
  interface Window {
    codex: CodexDesktopApi;
    agentTeam: AgentTeamApi;
    im: ImDesktopApi;
    backend: BackendDesktopApi;
  }
}

export {};
