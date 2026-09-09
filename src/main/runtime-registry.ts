import type { AgentCapability, AgentDefinition, AgentRuntimeBinding } from "../shared/agent-team";
import { parseCustomAgentManifest, type CustomAgentManifest } from "../shared/agent-protocol";
import type { AgentRuntime } from "./agent-runtime";
import { CustomCliRuntime, CustomHttpRuntime } from "./custom-agent-runtime";

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly credentials = new Map<string, string>();
  private credentialResolver: ((agentId: string) => string) | undefined;
  private readonly listeners = new Set<
    (event: import("./agent-runtime").AgentRuntimeEvent) => void
  >();
  private readonly unsubscribers = new Map<string, () => void>();

  register(key: string, runtime: AgentRuntime) {
    const normalized = key.trim();
    if (!normalized) throw new Error("Runtime 注册名不能为空。");
    if (this.runtimes.has(normalized)) throw new Error(`Runtime 已注册：${normalized}。`);
    this.runtimes.set(normalized, runtime);
    this.unsubscribers.set(
      normalized,
      runtime.onEvent((event) => {
        for (const listener of this.listeners) listener(event);
      }),
    );
    return runtime;
  }

  registerCustom(manifestInput: CustomAgentManifest, token = "") {
    const manifest = parseCustomAgentManifest(manifestInput);
    const runtime =
      manifest.transport === "http"
        ? new CustomHttpRuntime(manifest, token)
        : new CustomCliRuntime(manifest);
    return this.register(manifest.agentId, runtime);
  }

  setCredentialResolver(resolver: (agentId: string) => string) {
    this.credentialResolver = resolver;
  }

  setCredential(agentId: string, token: string) {
    const previous = this.credentials.get(agentId) ?? this.credentialResolver?.(agentId) ?? "";
    if (previous === token) return;
    if (token) this.credentials.set(agentId, token);
    else this.credentials.delete(agentId);
    this.unregister(agentId);
  }

  unregister(key: string) {
    const runtime = this.runtimes.get(key);
    if (!runtime) return;
    this.unsubscribers.get(key)?.();
    this.unsubscribers.delete(key);
    this.runtimes.delete(key);
    const dispose = (runtime as AgentRuntime & { dispose?: () => void }).dispose;
    dispose?.();
  }

  clearCredentials() {
    const keys = [...this.credentials.keys()];
    this.credentials.clear();
    for (const key of keys) this.unregister(key);
  }

  resolve(agent: AgentDefinition) {
    return this.resolveBinding(
      agent.id,
      agent.runtime?.provider,
      agent.runtime,
      agent.capabilities,
    );
  }

  resolveBinding(
    agentId: string,
    provider?: string,
    binding?: AgentRuntimeBinding,
    capabilities: AgentCapability[] = [],
    token?: string,
  ) {
    let runtime =
      this.runtimes.get(agentId) ?? (provider ? this.runtimes.get(provider) : undefined);
    if (!runtime && binding && (provider === "custom-http" || provider === "custom-cli")) {
      const credential =
        binding.auth === "bearer"
          ? (token ?? this.credentials.get(agentId) ?? this.credentialResolver?.(agentId) ?? "")
          : "";
      runtime = this.registerCustom(
        {
          protocolVersion: 1,
          agentId,
          name: agentId,
          version: binding.version ?? "1",
          capabilities,
          transport: provider === "custom-cli" ? "cli-jsonl" : "http",
          endpoint: binding.endpoint,
          command: binding.command,
          args: binding.args,
          auth: binding.auth ?? "none",
        },
        credential,
      );
    }
    if (!runtime) throw new Error(`没有为 Agent ${agentId} 注册可用 Runtime。`);
    return runtime;
  }

  onEvent(listener: (event: import("./agent-runtime").AgentRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
    this.unsubscribers.clear();
    for (const runtime of this.runtimes.values()) {
      const dispose = (runtime as AgentRuntime & { dispose?: () => void }).dispose;
      dispose?.();
    }
    this.listeners.clear();
  }

  assertCapabilities(runtime: AgentRuntime, required: AgentCapability[]) {
    const available = new Set(runtime.capabilities);
    const missing = [...new Set(required)].filter((capability) => !available.has(capability));
    if (missing.length) {
      throw new Error(`Runtime ${runtime.provider} 不支持所需能力：${missing.join(", ")}。`);
    }
  }
}
