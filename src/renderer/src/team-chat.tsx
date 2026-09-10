import {
  ArrowLeftIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  CircleAlertIcon,
  Clock3Icon,
  EyeIcon,
  FolderKanbanIcon,
  Globe2Icon,
  LoaderCircleIcon,
  LockIcon,
  MessageSquareMoreIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Repeat2Icon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
  SquareIcon,
  Trash2Icon,
  UserRoundCogIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  AgentDefinition,
  AgentLoopSession,
  AgentMessageAction,
  AgentRuntimeBinding,
  AgentTask,
  AgentSession,
  HumanContact,
  ImConfigInput,
  ImPublicConfig,
  TaskStatus,
  TeamEvent,
  TeamMessage,
  TeamRoomSnapshot,
  TeamWorkspaceSnapshot,
} from "../../shared/agent-team";
import { formatErrorMessage } from "../../shared/error";
import { openImTransport, type OpenImConnectionState } from "./openim-transport";
import {
  buildMentionCandidates,
  mentionedCandidates,
  type MentionCandidate,
} from "./openim-mentions";

export type TeamView = "messages" | "contacts" | "tasks";

const LOCAL_ROOM_ID = "local-agent-team";
const activeTaskStatuses: TaskStatus[] = [
  "pending_review",
  "changes_requested",
  "approved",
  "queued",
  "running",
  "waiting",
  "review",
  "blocked",
];
const taskLabels: Record<TaskStatus, string> = {
  pending_review: "待人工审核",
  changes_requested: "待修改",
  approved: "已审核",
  queued: "待处理",
  running: "执行中",
  waiting: "等待确认",
  review: "待验收",
  blocked: "已阻塞",
  done: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};
const sessionLabels: Record<AgentSession["state"], string> = {
  pending: "待处理",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  waiting: "等待下一轮",
};
const taskTone: Record<TaskStatus, string> = {
  pending_review: "border-amber-300/15 bg-amber-300/7 text-amber-300",
  changes_requested: "border-orange-300/15 bg-orange-300/7 text-orange-300",
  approved: "border-emerald-300/15 bg-emerald-300/7 text-emerald-300",
  queued: "border-zinc-300/10 bg-zinc-300/5 text-zinc-400",
  running: "border-cyan-300/15 bg-cyan-300/7 text-cyan-300",
  waiting: "border-amber-300/15 bg-amber-300/7 text-amber-300",
  review: "border-violet-300/15 bg-violet-300/7 text-violet-300",
  blocked: "border-red-300/15 bg-red-300/7 text-red-300",
  done: "border-emerald-300/15 bg-emerald-300/7 text-emerald-300",
  failed: "border-red-300/15 bg-red-300/7 text-red-300",
  cancelled: "border-zinc-300/10 bg-zinc-300/5 text-zinc-500",
};

const themeClasses: Record<
  AgentDefinition["theme"],
  { avatar: string; chip: string; dot: string }
> = {
  cyan: {
    avatar: "border-cyan-300/20 bg-cyan-300/10 text-cyan-200",
    chip: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    dot: "bg-cyan-300",
  },
  violet: {
    avatar: "border-violet-300/20 bg-violet-300/10 text-violet-200",
    chip: "border-violet-300/25 bg-violet-300/10 text-violet-100",
    dot: "bg-violet-300",
  },
  amber: {
    avatar: "border-amber-300/20 bg-amber-300/10 text-amber-200",
    chip: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    dot: "bg-amber-300",
  },
  emerald: {
    avatar: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
    chip: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
    dot: "bg-emerald-300",
  },
};

const emptyImConfig: ImPublicConfig = {
  apiAddr: "",
  wsAddr: "",
  userId: "",
  groupId: "",
  gatewayUrl: "",
  hostRemoteMessages: false,
  hasUserToken: false,
  hasGatewaySecret: false,
};

const timeLabel = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(timestamp);
const dateLabel = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

const cloudAgentBody = (agent: AgentDefinition, runtimeToken = "") => ({
  name: agent.name,
  title: agent.title,
  mention: agent.mention,
  description: agent.description,
  instructions: agent.instructions,
  visibility: agent.visibility,
  workspaceAccess: agent.workspaceAccess,
  executionTarget: agent.executionLocation,
  provider: agent.runtime?.provider ?? "codex",
  protocol: agent.runtime?.protocol ?? "app-server",
  runtimeModel: agent.runtime?.model,
  runtimeEndpoint: agent.runtime?.endpoint,
  runtimeCommand: agent.runtime?.command,
  runtimeArgs: agent.runtime?.args ?? [],
  runtimeAuth: agent.runtime?.auth ?? "none",
  capabilities: agent.capabilities ?? [
    "chat",
    "stream_progress",
    "read_workspace",
    ...(agent.workspaceAccess === "write" ? ["write_workspace", "run_command"] : []),
  ],
  skillPolicy: agent.skillPolicy ?? "none",
  skillRefs: agent.skillRefs ?? [],
  secrets: runtimeToken ? { bearerToken: runtimeToken } : {},
});

const runtimeProtocol = (provider: string) =>
  provider === "codex"
    ? "app-server"
    : provider === "opencode"
      ? "acp"
      : provider === "custom-http"
        ? "http"
        : provider === "custom-cli"
          ? "cli-jsonl"
          : "cli-stream-json";
const cloudAgentUpdateBody = (agent: AgentDefinition, runtimeToken?: string) => {
  const { secrets: _secrets, ...body } = cloudAgentBody(agent);
  return runtimeToken === undefined ? body : { ...body, secrets: { bearerToken: runtimeToken } };
};

const upsertRoom = (rooms: TeamRoomSnapshot[], room: TeamRoomSnapshot) => {
  const index = rooms.findIndex((candidate) => candidate.roomId === room.roomId);
  if (index < 0) return [...rooms, room];
  const next = [...rooms];
  next[index] = room;
  return next;
};

const upsertTask = (tasks: AgentTask[], task: AgentTask) => {
  const index = tasks.findIndex((candidate) => candidate.id === task.id);
  if (index < 0) return [task, ...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
};

const upsertLoop = (loops: AgentLoopSession[], loop: AgentLoopSession) => {
  const index = loops.findIndex((candidate) => candidate.id === loop.id);
  if (index < 0) return [loop, ...loops];
  const next = [...loops];
  next[index] = loop;
  return next;
};

const upsertSession = (sessions: AgentSession[], session: AgentSession) => {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index < 0) return [session, ...sessions];
  const next = [...sessions];
  next[index] = session;
  return next;
};

const applyEvent = (state: TeamWorkspaceSnapshot, event: TeamEvent) => {
  if (event.type === "workspace-snapshot") return event.snapshot;
  if (event.type === "agents-upsert") return { ...state, agents: event.agents };
  if (event.type === "humans-upsert") return { ...state, humans: event.humans };
  if (event.type === "room-upsert") return { ...state, rooms: upsertRoom(state.rooms, event.room) };
  if (event.type === "task-upsert") return { ...state, tasks: upsertTask(state.tasks, event.task) };
  if (event.type === "loop-upsert") return { ...state, loops: upsertLoop(state.loops, event.loop) };
  if (event.type === "session-upsert") {
    return { ...state, sessions: upsertSession(state.sessions, event.session) };
  }
  const room = state.rooms.find((candidate) => candidate.roomId === event.roomId);
  if (!room) return state;
  const messages = [...room.messages];
  const index = messages.findIndex((candidate) => candidate.id === event.message.id);
  if (index < 0) messages.push(event.message);
  else messages[index] = event.message;
  return { ...state, rooms: upsertRoom(state.rooms, { ...room, messages }) };
};

const ConnectionBadge = ({ status }: { status: OpenImConnectionState }) => {
  if (status.state === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-amber-200/80">
        <LoaderCircleIcon className="size-3 animate-spin" />
        连接中
      </span>
    );
  }
  if (status.state === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-emerald-300/80">
        <span className="size-1.5 rounded-full bg-emerald-300" />
        OpenIM
      </span>
    );
  }
  if (status.state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-red-300/80">
        <CircleAlertIcon className="size-3" />
        连接失败
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-zinc-600">
      <span className="size-1.5 rounded-full bg-zinc-600" />
      本地实时
    </span>
  );
};

const MessageBody = ({ content }: { content: string }) => (
  <div className="team-markdown min-w-0 text-sm leading-6 text-zinc-200">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer" className="text-cyan-300 underline">
            {children}
          </a>
        ),
        code: ({ children, className, ...props }) =>
          className ? (
            <code {...props} className={`${className} font-mono text-xs`}>
              {children}
            </code>
          ) : (
            <code
              {...props}
              className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[12px] text-cyan-100"
            >
              {children}
            </code>
          ),
        pre: ({ children }) => (
          <pre className="my-3 overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-3 font-mono text-xs leading-5">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const StatusPill = ({ status }: { status: TaskStatus }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[9px] ${taskTone[status]}`}>
    {taskLabels[status]}
  </span>
);

const MessageRow = ({
  message,
  agent,
  task,
  onStop,
  onOpenTask,
}: {
  message: TeamMessage;
  agent?: AgentDefinition;
  task?: AgentTask;
  onStop: (runId: string) => void;
  onOpenTask: (task: AgentTask) => void;
}) => {
  if (message.senderType === "system") {
    return <div className="py-3 text-center text-[10px] text-zinc-600">{message.content}</div>;
  }
  const isUser = message.senderType === "user";
  const running = message.status === "pending" || message.status === "streaming";
  const theme = agent ? themeClasses[agent.theme] : themeClasses.cyan;

  if (isUser) {
    return (
      <article className="flex justify-end gap-3 py-3">
        <div className="max-w-[min(44rem,78%)]">
          <div className="mb-1.5 flex items-center justify-end gap-2 text-[10px] text-zinc-600">
            <span>{timeLabel(message.createdAt)}</span>
            <span>{message.senderName}</span>
          </div>
          <div className="rounded-2xl rounded-tr-md border border-cyan-300/15 bg-cyan-300/10 px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-cyan-50">
            {message.content}
          </div>
          {task && (
            <button
              type="button"
              onClick={() => onOpenTask(task)}
              className="mt-2 flex w-full items-center gap-3 rounded-xl border border-violet-300/12 bg-violet-300/5 px-3 py-2.5 text-left transition hover:border-violet-300/25 hover:bg-violet-300/8"
            >
              <FolderKanbanIcon className="size-4 shrink-0 text-violet-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-zinc-300">{task.title}</span>
                <span className="mt-0.5 block text-[9px] text-zinc-600">
                  已创建 Task 小群 · {task.assigneeIds.length} 位 Agent
                </span>
              </span>
              <StatusPill status={task.status} />
            </button>
          )}
        </div>
        <div className="mt-5 grid size-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/8 text-xs font-semibold text-zinc-200">
          我
        </div>
      </article>
    );
  }

  return (
    <article className="group flex gap-3 py-3">
      <div
        className={`mt-5 grid size-8 shrink-0 place-items-center rounded-xl border text-xs font-semibold ${theme.avatar}`}
      >
        {agent?.initials ?? "AI"}
      </div>
      <div className="min-w-0 max-w-[min(48rem,82%)] flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-[10px]">
          <span className="font-medium text-zinc-300">{message.senderName}</span>
          {agent && <span className="text-zinc-600">{agent.title}</span>}
          <span className="text-zinc-700">{timeLabel(message.createdAt)}</span>
        </div>
        <div className="rounded-2xl rounded-tl-md border border-white/8 bg-white/[0.035] px-4 py-3 shadow-sm shadow-black/10">
          {message.content ? <MessageBody content={message.content} /> : null}
          {message.activity && (
            <div className="flex items-center gap-2 py-1 text-xs text-zinc-500">
              <LoaderCircleIcon className="size-3.5 animate-spin text-cyan-300" />
              {message.activity}
            </div>
          )}
          {message.status === "cancelled" && (
            <div className="text-xs text-zinc-600">已停止生成</div>
          )}
          {message.error && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-400/7 px-3 py-2 text-xs leading-5 text-red-300/80">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                {(() => {
                  const formatted = formatErrorMessage(message.error, "执行失败");
                  const [summary, raw] = formatted.split("原始报错：", 2);
                  return (
                    <>
                      <span className="block whitespace-pre-wrap">{summary.trim()}</span>
                      {raw && (
                        <details className="mt-1 text-[10px] text-red-200/55">
                          <summary className="cursor-pointer select-none">查看原始报错</summary>
                          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">
                            {raw.trim()}
                          </pre>
                        </details>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
        {running && message.runId && (
          <button
            type="button"
            onClick={() => onStop(message.runId!)}
            className="mt-2 flex items-center gap-1.5 text-[10px] text-zinc-600 opacity-0 transition hover:text-zinc-300 group-hover:opacity-100"
          >
            <SquareIcon className="size-2.5 fill-current" />
            停止
          </button>
        )}
      </div>
    </article>
  );
};

const Modal = ({ children }: { children: React.ReactNode }) => (
  <div className="absolute inset-0 z-50 grid place-items-center bg-black/70 p-6 backdrop-blur-sm">
    {children}
  </div>
);

const ImSettings = ({
  config,
  onClose,
  onSaved,
}: {
  config: ImPublicConfig;
  onClose: () => void;
  onSaved: (config: ImPublicConfig) => void;
}) => {
  const [form, setForm] = useState<ImConfigInput>({
    apiAddr: config.apiAddr,
    wsAddr: config.wsAddr,
    userId: config.userId,
    groupId: config.groupId,
    gatewayUrl: config.gatewayUrl,
    hostRemoteMessages: config.hostRemoteMessages,
    userToken: "",
    gatewaySecret: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await window.im.saveConfig(form));
      onClose();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal>
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#11151e] shadow-2xl">
        <header className="flex items-start justify-between border-b border-white/7 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">连接 OpenIM</h2>
            <p className="mt-1 text-xs text-zinc-500">留空即可使用本地群与 Task 房间。</p>
          </div>
          <button type="button" onClick={onClose}>
            <XIcon className="size-4 text-zinc-600" />
          </button>
        </header>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {(
            [
              ["apiAddr", "OpenIM API", "http://127.0.0.1:10002"],
              ["wsAddr", "OpenIM WebSocket", "ws://127.0.0.1:10001"],
              ["userId", "当前用户 ID", "user_001"],
              ["groupId", "群组 ID", "group_001"],
              ["gatewayUrl", "Agent Gateway", "http://127.0.0.1:8787"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className={key === "gatewayUrl" ? "sm:col-span-2" : ""}>
              <span className="mb-1.5 block text-[10px] tracking-wider text-zinc-500 uppercase">
                {label}
              </span>
              <input
                value={form[key]}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [key]: event.target.value }))
                }
                placeholder={placeholder}
                className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs outline-none focus:border-cyan-300/30"
              />
            </label>
          ))}
          <label>
            <span className="mb-1.5 block text-[10px] tracking-wider text-zinc-500 uppercase">
              用户 Token
            </span>
            <input
              type="password"
              value={form.userToken}
              onChange={(event) =>
                setForm((current) => ({ ...current, userToken: event.target.value }))
              }
              placeholder={config.hasUserToken ? "已保存，留空保持" : "OpenIM user token"}
              className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs outline-none"
            />
          </label>
          <label>
            <span className="mb-1.5 block text-[10px] tracking-wider text-zinc-500 uppercase">
              Gateway 密钥
            </span>
            <input
              type="password"
              value={form.gatewaySecret}
              onChange={(event) =>
                setForm((current) => ({ ...current, gatewaySecret: event.target.value }))
              }
              placeholder={config.hasGatewaySecret ? "已保存，留空保持" : "桌面端发布凭据"}
              className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs outline-none"
            />
          </label>
          <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-white/7 bg-black/10 p-3">
            <input
              type="checkbox"
              checked={form.hostRemoteMessages}
              onChange={(event) =>
                setForm((current) => ({ ...current, hostRemoteMessages: event.target.checked }))
              }
              className="mt-0.5 accent-cyan-300"
            />
            <span>
              <span className="block text-xs text-zinc-300">作为这个群的 Agent Host</span>
              <span className="mt-1 block text-[10px] leading-5 text-zinc-600">
                接收远端群消息并创建本机 Task。
              </span>
            </span>
          </label>
          {error && <p className="sm:col-span-2 text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/7 px-5 py-4">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-zinc-500">
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-cyan-950 disabled:opacity-50"
          >
            {saving ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <CheckIcon className="size-3.5" />
            )}
            保存并连接
          </button>
        </footer>
      </div>
    </Modal>
  );
};

const AgentSettings = ({
  workspace,
  agents,
  initialAgentId,
  cloudMode,
  syncCloudWorkspace,
  onClose,
  onSaved,
}: {
  workspace: string;
  agents: AgentDefinition[];
  initialAgentId?: string;
  cloudMode: boolean;
  syncCloudWorkspace: () => Promise<TeamWorkspaceSnapshot>;
  onClose: () => void;
  onSaved: (snapshot: TeamWorkspaceSnapshot) => void;
}) => {
  const [drafts, setDrafts] = useState(() => structuredClone(agents));
  const originalAgents = useRef(structuredClone(agents));
  const [activeId, setActiveId] = useState(initialAgentId ?? agents[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [runtimeToken, setRuntimeToken] = useState("");
  const [runtimeTokenConfigured, setRuntimeTokenConfigured] = useState(false);
  const runtimeTokens = useRef(new Map<string, string>());
  const runtimeCredentialChanges = useRef(new Set<string>());
  const [invitations, setInvitations] = useState<
    Array<{
      id: string;
      roomName: string;
      agentName: string;
      status: string;
    }>
  >([]);
  const refreshInvitations = useCallback(async () => {
    if (!cloudMode) return;
    const response = await window.backend.request<{ data: typeof invitations }>({
      path: "/v1/agent-invitations",
    });
    setInvitations(response.data);
  }, [cloudMode]);
  useEffect(() => {
    void refreshInvitations().catch(() => undefined);
  }, [refreshInvitations]);
  useEffect(() => {
    setRuntimeToken(runtimeTokens.current.get(activeId) ?? "");
    void window.agentTeam
      .getRuntimeCredentialStatus({ agentId: activeId })
      .then((result) => setRuntimeTokenConfigured(result.configured))
      .catch(() => setRuntimeTokenConfigured(false));
  }, [activeId]);
  const activeIndex = Math.max(
    0,
    drafts.findIndex((agent) => agent.id === activeId),
  );
  const active = drafts[activeIndex];
  const activeRuntime: AgentRuntimeBinding = active?.runtime ?? {
    provider: "codex",
    protocol: "app-server",
    target: active?.executionLocation ?? "local",
  };
  const canEditActive = active?.ownerId === "local_user";
  const update = <K extends keyof AgentDefinition>(key: K, value: AgentDefinition[K]) =>
    canEditActive &&
    setDrafts((current) =>
      current.map((agent, index) => (index === activeIndex ? { ...agent, [key]: value } : agent)),
    );
  const addAgent = () => {
    if (drafts.filter((agent) => agent.ownerId === "local_user").length >= 24) return;
    const suffix = Date.now().toString(36);
    const next: AgentDefinition = {
      id: `agent_custom_${suffix}`,
      name: "新 Agent",
      title: "Custom Agent",
      mention: `@新Agent${drafts.length + 1}`,
      initials: "新",
      theme: "cyan",
      description: "自定义 Agent 工作者",
      instructions: "你是协作群中的自定义 Agent。围绕自己的职责回答，不要替其他 Agent 发言。",
      workspaceAccess: "read",
      visibility: "private",
      ownerId: "local_user",
      executionLocation: "local",
      source: "local",
      runtime: { provider: "codex", protocol: "app-server", target: "local" },
      capabilities: ["chat", "stream_progress", "read_workspace"],
    };
    setDrafts((current) => [...current, next]);
    setActiveId(next.id);
  };
  const removeAgent = () => {
    if (!active || !canEditActive || drafts.length <= 1) return;
    const next = drafts.filter((agent) => agent.id !== active.id);
    setDrafts(next);
    setActiveId(next[0]?.id ?? "");
  };
  const respondInvitation = async (id: string, action: "accept" | "reject") => {
    setError("");
    try {
      await window.backend.request({
        method: "POST",
        path: `/v1/agent-invitations/${encodeURIComponent(id)}/${action}`,
      });
      const snapshot = await syncCloudWorkspace();
      onSaved(snapshot);
      await refreshInvitations();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (cloudMode) {
        const originalById = new Map(originalAgents.current.map((agent) => [agent.id, agent]));
        const removedRemote = originalAgents.current.filter(
          (agent) =>
            (agent.syncSource === "backend" || Boolean(agent.cloudAgentId)) &&
            agent.ownerId === "local_user" &&
            !drafts.some((draft) => draft.id === agent.id),
        );
        for (const agent of removedRemote) {
          await window.backend.request({
            method: "DELETE",
            path: `/v1/agents/${encodeURIComponent(agent.cloudAgentId ?? agent.id)}`,
          });
        }
        for (const agent of drafts) {
          const original = originalById.get(agent.id);
          const tokenChanged = runtimeCredentialChanges.current.has(agent.id);
          const token = runtimeTokens.current.get(agent.id)?.trim() ?? "";
          const cloudAgentId =
            agent.cloudAgentId ?? (agent.syncSource === "backend" ? agent.id : undefined);
          if (cloudAgentId && agent.ownerId === "local_user" && original) {
            if (JSON.stringify(agent) !== JSON.stringify(original) || tokenChanged) {
              await window.backend.request({
                method: "PATCH",
                path: `/v1/agents/${encodeURIComponent(cloudAgentId)}`,
                headers: { "if-match": String(agent.version ?? 1) },
                body: cloudAgentUpdateBody(agent, tokenChanged ? token : undefined),
              });
            }
          } else if (!original && agent.syncSource !== "backend") {
            await window.backend.request({
              method: "POST",
              path: "/v1/agents",
              body: cloudAgentBody(agent, token),
            });
          }
          if (tokenChanged && (!cloudMode || cloudAgentId)) {
            await window.agentTeam.saveRuntimeCredential({ agentId: agent.id, token });
          }
        }
      }
      const newCloudAgentIds = new Set(
        drafts
          .filter(
            (agent) =>
              cloudMode &&
              agent.syncSource !== "backend" &&
              !originalAgents.current.some((original) => original.id === agent.id),
          )
          .map((agent) => agent.id),
      );
      let snapshot = await window.agentTeam.saveAgents({
        workspace,
        agents: drafts.filter(
          (agent) => agent.syncSource !== "backend" && !newCloudAgentIds.has(agent.id),
        ),
      });
      if (cloudMode) snapshot = await syncCloudWorkspace();
      onSaved(snapshot);
      onClose();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal>
      <div className="flex h-[min(700px,90vh)] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#11151e] shadow-2xl">
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/7 bg-black/10 p-3">
          <div className="px-2 py-2 text-[10px] tracking-wider text-zinc-600 uppercase">
            我的 Agent
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {drafts.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setActiveId(agent.id)}
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left ${active?.id === agent.id ? "bg-white/8 text-white" : "text-zinc-500 hover:bg-white/4"}`}
              >
                <span
                  className={`grid size-7 place-items-center rounded-lg border text-[10px] ${themeClasses[agent.theme].avatar}`}
                >
                  {agent.initials}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{agent.name}</span>
                {agent.visibility === "public" ? (
                  <Globe2Icon className="size-3" />
                ) : (
                  <LockIcon className="size-3" />
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={addAgent}
            className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 py-2 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            <PlusIcon className="size-3" />
            创建 Agent
          </button>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between border-b border-white/7 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">定义 Agent 工作者</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {canEditActive
                  ? "这是你的 Agent，可以编辑角色、权限和公开范围。"
                  : "这是其他用户的公开 Agent，只能查看和邀请。"}
              </p>
            </div>
            <button type="button" onClick={onClose}>
              <XIcon className="size-4 text-zinc-600" />
            </button>
          </header>
          {active && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {invitations
                .filter((invitation) => invitation.status === "pending")
                .map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center gap-3 rounded-xl border border-amber-300/10 bg-amber-300/5 p-3"
                  >
                    <span className="min-w-0 flex-1 text-xs text-zinc-400">
                      「{invitation.roomName}」申请邀请 {invitation.agentName}
                    </span>
                    <button
                      type="button"
                      onClick={() => void respondInvitation(invitation.id, "reject")}
                      className="px-2 py-1 text-[10px] text-zinc-500"
                    >
                      拒绝
                    </button>
                    <button
                      type="button"
                      onClick={() => void respondInvitation(invitation.id, "accept")}
                      className="rounded-lg bg-emerald-300/10 px-2.5 py-1.5 text-[10px] text-emerald-200"
                    >
                      同意加入
                    </button>
                  </div>
                ))}
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["id", "Agent ID"],
                    ["name", "显示名称"],
                    ["title", "角色"],
                    ["mention", "提及名称"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <span className="mb-1.5 block text-[10px] tracking-wider text-zinc-500 uppercase">
                      {label}
                    </span>
                    <input
                      disabled={!canEditActive || key === "id"}
                      value={active[key]}
                      onChange={(event) => update(key, event.target.value)}
                      className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs outline-none focus:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45"
                    />
                  </label>
                ))}
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[10px] tracking-wider text-zinc-500 uppercase">
                  简介
                </span>
                <input
                  disabled={!canEditActive}
                  value={active.description}
                  onChange={(event) => update("description", event.target.value)}
                  className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[10px] tracking-wider text-zinc-500 uppercase">
                  角色指令
                </span>
                <textarea
                  disabled={!canEditActive}
                  value={active.instructions}
                  onChange={(event) => update("instructions", event.target.value)}
                  rows={7}
                  className="w-full resize-none rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs leading-5 outline-none"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">可见性</span>
                  <select
                    disabled={!canEditActive}
                    value={active.visibility}
                    onChange={(event) =>
                      update("visibility", event.target.value as AgentDefinition["visibility"])
                    }
                    className="w-full rounded-xl border border-white/8 bg-[#11151e] px-3 py-2.5 text-xs"
                  >
                    <option value="private">私有</option>
                    <option value="public">公开</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                    工作区权限
                  </span>
                  <select
                    disabled={!canEditActive}
                    value={active.workspaceAccess}
                    onChange={(event) =>
                      update(
                        "workspaceAccess",
                        event.target.value as AgentDefinition["workspaceAccess"],
                      )
                    }
                    className="w-full rounded-xl border border-white/8 bg-[#11151e] px-3 py-2.5 text-xs"
                  >
                    <option value="read">只读</option>
                    <option value="write">允许写入</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">运行位置</span>
                  <select
                    disabled={!canEditActive}
                    value={active.executionLocation}
                    onChange={(event) => {
                      const target = event.target.value as AgentDefinition["executionLocation"];
                      update("executionLocation", target);
                      update("runtime", {
                        ...activeRuntime,
                        target,
                      });
                    }}
                    className="w-full rounded-xl border border-white/8 bg-[#11151e] px-3 py-2.5 text-xs"
                  >
                    <option value="local">本机</option>
                    <option value="hosted">托管</option>
                  </select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                    执行 Runtime
                  </span>
                  <select
                    disabled={!canEditActive}
                    value={activeRuntime.provider}
                    onChange={(event) => {
                      const provider = event.target.value;
                      const currentRuntime = activeRuntime;
                      update("runtime", {
                        ...currentRuntime,
                        provider,
                        protocol: runtimeProtocol(provider),
                        target: active.executionLocation,
                      });
                    }}
                    className="w-full rounded-xl border border-white/8 bg-[#11151e] px-3 py-2.5 text-xs"
                  >
                    <option value="codex">Codex（内置）</option>
                    <option value="claude">Claude（内置）</option>
                    <option value="opencode">OpenCode（内置）</option>
                    <option value="antigravity">Antigravity（内置）</option>
                    <option value="custom-http">自定义 HTTP Agent</option>
                    <option value="custom-cli">自定义 CLI Agent</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                    Runtime 模型（可选）
                  </span>
                  <input
                    disabled={!canEditActive}
                    value={activeRuntime.model ?? ""}
                    onChange={(event) =>
                      update("runtime", {
                        ...activeRuntime,
                        model: event.target.value.trim() || undefined,
                      })
                    }
                    placeholder="留空使用 Runtime 默认模型"
                    className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs disabled:opacity-45"
                  />
                </label>
              </div>
              {(activeRuntime.provider === "custom-http" ||
                activeRuntime.provider === "custom-cli") && (
                <>
                  <label>
                    <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                      {activeRuntime.provider === "custom-http" ? "Agent Endpoint" : "Agent 命令"}
                    </span>
                    <input
                      disabled={!canEditActive}
                      value={
                        activeRuntime.provider === "custom-http"
                          ? (activeRuntime.endpoint ?? "")
                          : (activeRuntime.command ?? "")
                      }
                      onChange={(event) =>
                        update("runtime", {
                          ...activeRuntime,
                          ...(activeRuntime.provider === "custom-http"
                            ? { endpoint: event.target.value.trim() || undefined }
                            : { command: event.target.value.trim() || undefined }),
                        })
                      }
                      placeholder={
                        activeRuntime.provider === "custom-http"
                          ? "https://agent.example.com"
                          : "例如：my-agent --protocol jsonl"
                      }
                      className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs disabled:opacity-45"
                    />
                  </label>
                  {activeRuntime.provider === "custom-http" && (
                    <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                      <label>
                        <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                          认证方式
                        </span>
                        <select
                          disabled={!canEditActive}
                          value={activeRuntime.auth ?? "none"}
                          onChange={(event) =>
                            update("runtime", {
                              ...activeRuntime,
                              auth: event.target.value === "bearer" ? "bearer" : "none",
                            })
                          }
                          className="w-full rounded-xl border border-white/8 bg-[#11151e] px-3 py-2.5 text-xs"
                        >
                          <option value="none">无需认证</option>
                          <option value="bearer">Bearer Token</option>
                        </select>
                      </label>
                      {activeRuntime.auth === "bearer" && (
                        <label>
                          <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                            Bearer Token
                          </span>
                          <div className="flex gap-2">
                            <input
                              disabled={!canEditActive}
                              type="password"
                              autoComplete="off"
                              value={runtimeToken}
                              onChange={(event) => {
                                const value = event.target.value;
                                runtimeTokens.current.set(activeId, value);
                                runtimeCredentialChanges.current.add(activeId);
                                setRuntimeToken(value);
                              }}
                              placeholder={
                                runtimeTokenConfigured ? "已配置，留空保持不变" : "输入 Token"
                              }
                              className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs disabled:opacity-45"
                            />
                            {runtimeTokenConfigured && (
                              <button
                                type="button"
                                disabled={!canEditActive}
                                onClick={() => {
                                  runtimeTokens.current.set(activeId, "");
                                  runtimeCredentialChanges.current.add(activeId);
                                  setRuntimeToken("");
                                  setRuntimeTokenConfigured(false);
                                }}
                                className="shrink-0 px-2 text-[10px] text-red-300/70 hover:text-red-300 disabled:opacity-40"
                              >
                                清除
                              </button>
                            )}
                          </div>
                        </label>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                    Skills 权限
                  </span>
                  <select
                    disabled={!canEditActive}
                    value={active.skillPolicy ?? "none"}
                    onChange={(event) =>
                      update(
                        "skillPolicy",
                        event.target.value as NonNullable<AgentDefinition["skillPolicy"]>,
                      )
                    }
                    className="w-full rounded-xl border border-white/8 bg-[#11151e] px-3 py-2.5 text-xs"
                  >
                    <option value="none">不允许 Skill</option>
                    <option value="allowlist">仅允许列表</option>
                    <option value="all">允许全部</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">
                    Skill 名称白名单
                  </span>
                  <input
                    disabled={!canEditActive || active.skillPolicy !== "allowlist"}
                    value={(active.skillRefs ?? []).map((skill) => skill.name).join(", ")}
                    onChange={(event) =>
                      update(
                        "skillRefs",
                        event.target.value
                          .split(",")
                          .map((name) => name.trim())
                          .filter(Boolean)
                          .map((name) => ({ name })),
                      )
                    }
                    placeholder="例如：openai-docs, pdf"
                    className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs disabled:opacity-45"
                  />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">头像文字</span>
                  <input
                    disabled={!canEditActive}
                    value={active.initials}
                    onChange={(event) => update("initials", event.target.value)}
                    className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-xs"
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">颜色</span>
                  <select
                    disabled={!canEditActive}
                    value={active.theme}
                    onChange={(event) =>
                      update("theme", event.target.value as AgentDefinition["theme"])
                    }
                    className="w-full rounded-xl border border-white/8 bg-[#11151e] px-3 py-2.5 text-xs"
                  >
                    <option value="cyan">青色</option>
                    <option value="violet">紫色</option>
                    <option value="emerald">绿色</option>
                    <option value="amber">琥珀色</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                disabled={drafts.length <= 1 || !canEditActive}
                onClick={removeAgent}
                className="flex items-center gap-2 text-[10px] text-red-300/60 hover:text-red-300 disabled:opacity-30"
              >
                <Trash2Icon className="size-3" />
                删除这个 Agent
              </button>
              {error && <p className="text-xs text-red-300">{error}</p>}
            </div>
          )}
          <footer className="flex justify-end gap-2 border-t border-white/7 px-5 py-4">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-zinc-500">
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-cyan-950 disabled:opacity-50"
            >
              {saving ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
              保存 Agent
            </button>
          </footer>
        </section>
      </div>
    </Modal>
  );
};

const ContactSettings = ({
  workspace,
  humans,
  cloudMode,
  syncCloudWorkspace,
  onClose,
  onSaved,
}: {
  workspace: string;
  humans: HumanContact[];
  cloudMode: boolean;
  syncCloudWorkspace: () => Promise<TeamWorkspaceSnapshot>;
  onClose: () => void;
  onSaved: (snapshot: TeamWorkspaceSnapshot) => void;
}) => {
  const [drafts, setDrafts] = useState(() => structuredClone(humans));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<
    Array<{ id: string; handle: string; displayName: string }>
  >([]);
  const [requests, setRequests] = useState<
    Array<{
      id: string;
      senderId: string;
      receiverId: string;
      senderName: string;
      senderHandle: string;
      status: string;
    }>
  >([]);
  const [cloudUserId, setCloudUserId] = useState("");
  const refreshRequests = useCallback(async () => {
    if (!cloudMode) return;
    const [state, response] = await Promise.all([
      window.backend.getState(),
      window.backend.request<{ data: typeof requests }>({ path: "/v1/friend-requests" }),
    ]);
    setCloudUserId(state.user?.id ?? "");
    setRequests(response.data);
  }, [cloudMode]);
  useEffect(() => {
    void refreshRequests().catch((nextError) => setError(formatErrorMessage(nextError)));
  }, [refreshRequests]);
  const add = () => {
    const suffix = Date.now().toString(36);
    setDrafts((current) => [
      ...current,
      {
        id: `friend_${suffix}`,
        name: "新好友",
        initials: "友",
        title: "Teammate",
        status: "offline" as const,
      },
    ]);
  };
  const update = (id: string, values: Partial<HumanContact>) =>
    setDrafts((current) =>
      current.map((human) => (human.id === id ? { ...human, ...values } : human)),
    );
  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError("");
    try {
      const response = await window.backend.request<{ data: typeof results }>({
        path: `/v1/users/search?q=${encodeURIComponent(query.trim())}&limit=20`,
      });
      setResults(response.data);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSearching(false);
    }
  };
  const requestFriend = async (receiverId: string) => {
    setError("");
    try {
      await window.backend.request({
        method: "POST",
        path: "/v1/friend-requests",
        body: { receiverId, message: "希望在 Agent Team 中添加你为好友。" },
      });
      setResults((current) => current.filter((result) => result.id !== receiverId));
      await refreshRequests();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const acceptRequest = async (requestId: string) => {
    setError("");
    try {
      await window.backend.request({
        method: "POST",
        path: `/v1/friend-requests/${encodeURIComponent(requestId)}/accept`,
      });
      const snapshot = await syncCloudWorkspace();
      setDrafts(structuredClone(snapshot.humans));
      onSaved(snapshot);
      await refreshRequests();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const remove = async (human: HumanContact) => {
    setError("");
    if (human.syncSource !== "backend") {
      setDrafts((current) => current.filter((item) => item.id !== human.id));
      return;
    }
    try {
      await window.backend.request({
        method: "DELETE",
        path: `/v1/friends/${encodeURIComponent(human.id)}`,
      });
      const snapshot = await syncCloudWorkspace();
      setDrafts(structuredClone(snapshot.humans));
      onSaved(snapshot);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const snapshot = await window.agentTeam.saveHumans({ workspace, humans: drafts });
      onSaved(snapshot);
      onClose();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#11151e] shadow-2xl">
        <header className="flex items-start justify-between border-b border-white/7 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">管理好友</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {cloudMode
                ? "搜索远程用户、处理好友申请，也可保留本地联系人。"
                : "本地好友可被邀请进普通群或 Task 小群。"}
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <XIcon className="size-4 text-zinc-600" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
          {cloudMode && (
            <div className="mb-4 space-y-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.025] p-3">
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void search()}
                  placeholder="搜索邮箱、用户名或昵称"
                  className="min-w-0 flex-1 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-xs outline-none focus:border-cyan-300/30"
                />
                <button
                  type="button"
                  disabled={searching || query.trim().length < 2}
                  onClick={() => void search()}
                  className="grid size-8 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200 disabled:opacity-40"
                >
                  {searching ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    <SearchIcon className="size-3.5" />
                  )}
                </button>
              </div>
              {results.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center gap-3 rounded-lg bg-black/15 px-3 py-2"
                >
                  <span className="grid size-7 place-items-center rounded-lg bg-white/7 text-[10px]">
                    {result.displayName.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-zinc-300">
                      {result.displayName}
                    </span>
                    <span className="block text-[9px] text-zinc-600">@{result.handle}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void requestFriend(result.id)}
                    className="rounded-lg bg-cyan-300/10 px-2.5 py-1.5 text-[10px] text-cyan-200"
                  >
                    添加
                  </button>
                </div>
              ))}
              {requests
                .filter(
                  (request) => request.status === "pending" && request.receiverId === cloudUserId,
                )
                .map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center gap-3 rounded-lg border border-amber-300/10 bg-amber-300/5 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 text-xs text-zinc-300">
                      {request.senderName}{" "}
                      <span className="text-zinc-600">@{request.senderHandle}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void acceptRequest(request.id)}
                      className="rounded-lg bg-emerald-300/10 px-2.5 py-1.5 text-[10px] text-emerald-200"
                    >
                      接受申请
                    </button>
                  </div>
                ))}
            </div>
          )}
          {drafts.map((human) => {
            const owner = human.id === "local_user";
            const remote = human.syncSource === "backend";
            return (
              <div
                key={human.id}
                className="grid grid-cols-[2rem_1fr_1fr_auto] items-center gap-3 rounded-xl border border-white/7 bg-black/10 p-3"
              >
                <span className="grid size-8 place-items-center rounded-lg bg-white/7 text-xs">
                  {human.initials}
                </span>
                <input
                  disabled={owner || remote}
                  value={human.name}
                  onChange={(event) => update(human.id, { name: event.target.value })}
                  className="min-w-0 rounded-lg border border-white/7 bg-black/20 px-3 py-2 text-xs outline-none disabled:opacity-60"
                />
                <input
                  disabled={owner || remote}
                  value={human.title}
                  onChange={(event) => update(human.id, { title: event.target.value })}
                  className="min-w-0 rounded-lg border border-white/7 bg-black/20 px-3 py-2 text-xs outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={owner}
                  onClick={() => void remove(human)}
                  className="grid size-8 place-items-center text-red-300/50 hover:text-red-300 disabled:opacity-20"
                  title={owner ? "不能删除本机用户" : "删除好友"}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={add}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 py-3 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            <PlusIcon className="size-3" />
            添加好友
          </button>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/7 px-5 py-4">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-zinc-500">
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-cyan-950 disabled:opacity-50"
          >
            保存好友
          </button>
        </footer>
      </div>
    </Modal>
  );
};

const RoomDialog = ({
  workspace,
  room,
  agents,
  humans,
  cloudMode,
  syncCloudWorkspace,
  onClose,
  onSaved,
}: {
  workspace: string;
  room?: TeamRoomSnapshot;
  agents: AgentDefinition[];
  humans: HumanContact[];
  cloudMode: boolean;
  syncCloudWorkspace: () => Promise<TeamWorkspaceSnapshot>;
  onClose: () => void;
  onSaved: (room: TeamRoomSnapshot) => void;
}) => {
  const [name, setName] = useState(room?.name ?? "新协作群");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(room?.agentIds ?? []);
  const [selectedHumans, setSelectedHumans] = useState<string[]>(room?.humanIds ?? ["local_user"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const remoteSelection =
        selectedAgents.some((id) => {
          const agent = agents.find((candidate) => candidate.id === id);
          return agent?.syncSource === "backend" || Boolean(agent?.cloudAgentId);
        }) ||
        selectedHumans.some(
          (id) =>
            id !== "local_user" &&
            humans.find((human) => human.id === id)?.syncSource === "backend",
        );
      const useCloud = room?.syncSource === "backend" || (cloudMode && remoteSelection);
      let next: TeamRoomSnapshot;
      if (useCloud) {
        const localOnlyHumans = selectedHumans.filter(
          (id) =>
            id !== "local_user" &&
            humans.find((human) => human.id === id)?.syncSource !== "backend",
        );
        if (localOnlyHumans.length) {
          throw new Error("本地联系人没有远程账号，请先通过好友功能添加对方后再加入云端群。");
        }
        const localOnlyAgents = selectedAgents
          .map((id) => agents.find((agent) => agent.id === id))
          .filter((agent): agent is AgentDefinition =>
            Boolean(agent && agent.syncSource !== "backend" && !agent.cloudAgentId),
          );
        const promotedMappings = await Promise.all(
          localOnlyAgents.map(async (agent) => {
            const created = await window.backend.request<{
              id: string;
              openimUserId: string;
              version: number;
            }>({
              method: "POST",
              path: "/v1/agents",
              body: cloudAgentBody(agent),
            });
            return {
              localAgentId: agent.id,
              cloudAgentId: created.id,
              openimUserId: created.openimUserId,
              version: created.version,
            };
          }),
        );
        if (promotedMappings.length) {
          await window.agentTeam.promoteAgents({ workspace, mappings: promotedMappings });
        }
        const promotedByLocalId = new Map(
          promotedMappings.map((mapping) => [mapping.localAgentId, mapping.cloudAgentId]),
        );
        const cloudAgentIds = selectedAgents.map((id) => {
          const agent = agents.find((candidate) => candidate.id === id);
          return promotedByLocalId.get(id) ?? agent?.cloudAgentId ?? id;
        });
        const userIds = selectedHumans.filter((id) => id !== "local_user");
        let roomId: string;
        if (room) {
          let revision = room.revision ?? 1;
          if (name.trim() !== room.name) {
            const renamed = await window.backend.request<{ revision: number }>({
              method: "PATCH",
              path: `/v1/rooms/${encodeURIComponent(room.roomId)}`,
              headers: { "if-match": String(revision) },
              body: { name },
            });
            revision = renamed.revision;
          }
          await window.backend.request({
            method: "PUT",
            path: `/v1/rooms/${encodeURIComponent(room.roomId)}/members`,
            headers: { "if-match": String(revision) },
            body: { userIds, agentIds: cloudAgentIds },
          });
          roomId = room.roomId;
        } else {
          const created = await window.backend.request<{ id: string }>({
            method: "POST",
            path: "/v1/rooms",
            body: { name, userIds, agentIds: cloudAgentIds },
          });
          roomId = created.id;
        }
        const snapshot = await syncCloudWorkspace();
        const synced = snapshot.rooms.find((candidate) => candidate.roomId === roomId);
        if (!synced) throw new Error("云端群已保存，但同步结果中没有对应会话。");
        next = synced;
      } else {
        next = room
          ? await window.agentTeam.updateRoom({
              workspace,
              roomId: room.roomId,
              name,
              agentIds: selectedAgents,
              humanIds: selectedHumans,
            })
          : await window.agentTeam.createRoom({
              workspace,
              name,
              agentIds: selectedAgents,
              humanIds: selectedHumans,
            });
      }
      onSaved(next);
      onClose();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#11151e] shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/7 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{room ? "管理群组" : "新建群组"}</h2>
            <p className="mt-1 text-xs text-zinc-500">从通讯录邀请好友和 Agent。</p>
          </div>
          <button type="button" onClick={onClose}>
            <XIcon className="size-4 text-zinc-600" />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <label>
            <span className="mb-1.5 block text-[10px] text-zinc-500 uppercase">群名称</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-cyan-300/30"
            />
          </label>
          <div>
            <div className="mb-2 text-[10px] text-zinc-500 uppercase">Agent 成员</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {agents.map((agent) => {
                const checked = selectedAgents.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() =>
                      setSelectedAgents((current) =>
                        checked ? current.filter((id) => id !== agent.id) : [...current, agent.id],
                      )
                    }
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left ${checked ? "border-cyan-300/20 bg-cyan-300/7" : "border-white/7 bg-black/10"}`}
                  >
                    <span
                      className={`grid size-8 place-items-center rounded-lg border text-xs ${themeClasses[agent.theme].avatar}`}
                    >
                      {agent.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-zinc-300">{agent.name}</span>
                      <span className="mt-0.5 block text-[9px] text-zinc-600">
                        {agent.visibility === "public" ? "公开" : "私有"} ·{" "}
                        {agent.workspaceAccess === "write" ? "可写" : "只读"}
                      </span>
                    </span>
                    {checked && <CheckIcon className="size-3.5 text-cyan-300" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[10px] text-zinc-500 uppercase">好友成员</div>
            <div className="flex flex-wrap gap-2">
              {humans.map((human) => {
                const checked = selectedHumans.includes(human.id);
                const owner = human.id === "local_user";
                return (
                  <button
                    key={human.id}
                    type="button"
                    disabled={owner}
                    onClick={() =>
                      setSelectedHumans((current) =>
                        checked ? current.filter((id) => id !== human.id) : [...current, human.id],
                      )
                    }
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] ${checked ? "border-emerald-300/20 bg-emerald-300/7 text-emerald-200" : "border-white/7 text-zinc-600"}`}
                  >
                    <span>{human.initials}</span>
                    {human.name}
                    {checked && <CheckIcon className="size-3" />}
                  </button>
                );
              })}
            </div>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/7 px-5 py-4">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-zinc-500">
            取消
          </button>
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => void save()}
            className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-cyan-950 disabled:opacity-50"
          >
            {room ? "保存群组" : "创建群组"}
          </button>
        </footer>
      </div>
    </Modal>
  );
};

const ContactsView = ({
  state,
  onEditAgents,
  onEditHumans,
  onOpenDirect,
}: {
  state: TeamWorkspaceSnapshot;
  onEditAgents: (agentId?: string) => void;
  onEditHumans: () => void;
  onOpenDirect: (principalId: string) => void;
}) => {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (agent: AgentDefinition) =>
    !normalizedQuery ||
    [agent.name, agent.title, agent.description, agent.runtime?.provider]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
  const privateAgents = state.agents.filter((agent) => agent.visibility === "private");
  const publicAgents = state.agents.filter((agent) => agent.visibility === "public");
  const AgentCard = ({ agent }: { agent: AgentDefinition }) => {
    const owned = agent.ownerId === "local_user";
    const registryOffline = agent.source === "registry" && agent.runtimeStatus !== "online";
    const runtimeStatus =
      agent.runtimeStatus === "online"
        ? "在线"
        : agent.runtimeStatus === "offline"
          ? "离线"
          : "状态未知";
    return (
      <article className="rounded-2xl border border-white/7 bg-white/[0.025] p-4 transition hover:border-white/12 hover:bg-white/[0.04]">
        <div className="flex items-start gap-3">
          <div
            className={`grid size-11 shrink-0 place-items-center rounded-2xl border text-sm font-semibold ${themeClasses[agent.theme].avatar}`}
          >
            {agent.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-medium">{agent.name}</h3>
              {agent.visibility === "public" ? (
                <Globe2Icon className="size-3 text-emerald-300/70" />
              ) : (
                <LockIcon className="size-3 text-zinc-600" />
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-600">
              {agent.title} · {agent.runtime?.provider ?? "codex"} · {runtimeStatus}
            </p>
          </div>
          <span className={`size-2 rounded-full ${themeClasses[agent.theme].dot}`} />
        </div>
        <p className="mt-3 min-h-10 text-xs leading-5 text-zinc-500">{agent.description}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-zinc-500">
            {agent.mention}
          </span>
          <span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-zinc-500">
            {agent.workspaceAccess === "write" ? "工作区可写" : "只读"}
          </span>
          <button
            type="button"
            disabled={registryOffline}
            onClick={() => onOpenDirect(agent.id)}
            title={registryOffline ? "Agent 当前离线，暂时不能执行" : undefined}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-2 py-1 text-[9px] text-cyan-200 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquareMoreIcon className="size-3" />
            私聊
          </button>
          {owned ? (
            <button
              type="button"
              onClick={() => onEditAgents(agent.id)}
              className="flex items-center gap-1.5 rounded-lg border border-white/8 px-2 py-1 text-[9px] text-zinc-400 hover:border-cyan-300/20 hover:text-cyan-200"
            >
              <PencilIcon className="size-3" />
              编辑
            </button>
          ) : (
            <span className="text-[9px] text-zinc-700">他人公开</span>
          )}
        </div>
      </article>
    );
  };
  return (
    <div className="h-full overflow-y-auto">
      <header className="electron-drag sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/7 bg-[#080b12]/92 px-7 backdrop-blur-xl">
        <div>
          <h1 className="text-sm font-semibold">通讯录</h1>
          <p className="mt-0.5 text-[10px] text-zinc-600">好友与 Agent 工作者使用统一身份</p>
        </div>
        <div className="electron-no-drag flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/9 bg-white/5 px-3 py-2">
            <SearchIcon className="size-3.5 text-zinc-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Agent"
              aria-label="搜索 Agent"
              className="w-36 bg-transparent text-xs text-zinc-300 outline-none placeholder:text-zinc-700"
            />
          </label>
          <button
            type="button"
            onClick={onEditHumans}
            className="rounded-xl border border-white/9 bg-white/5 px-3 py-2 text-xs text-zinc-300"
          >
            管理好友
          </button>
          <button
            type="button"
            onClick={() => onEditAgents()}
            className="flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-950"
          >
            <PlusIcon className="size-3.5" />
            创建 Agent
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-8 p-7">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <UsersIcon className="size-4 text-zinc-500" />
            <h2 className="text-xs font-medium text-zinc-300">好友</h2>
            <span className="text-[10px] text-zinc-700">{state.humans.length}</span>
          </div>
          <div className="space-y-2">
            {state.humans.map((human) => (
              <article
                key={human.id}
                className="flex items-center gap-3 rounded-2xl border border-white/7 bg-white/[0.025] p-4"
              >
                <div className="grid size-10 place-items-center rounded-2xl border border-white/10 bg-white/7 text-xs">
                  {human.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-zinc-300">{human.name}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-600">{human.title}</div>
                </div>
                <span
                  className={`size-2 rounded-full ${human.status === "online" ? "bg-emerald-300" : "bg-zinc-700"}`}
                />
                {human.id !== "local_user" && (
                  <button
                    type="button"
                    onClick={() => onOpenDirect(human.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-2.5 py-1.5 text-[10px] text-cyan-200 hover:bg-cyan-300/10"
                  >
                    <MessageSquareMoreIcon className="size-3" />
                    私聊
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
        <section>
          <div className="mb-3 flex items-center gap-2">
            <LockIcon className="size-4 text-zinc-500" />
            <h2 className="text-xs font-medium text-zinc-300">我的私有 Agent</h2>
            <span className="text-[10px] text-zinc-700">{privateAgents.length}</span>
          </div>
          <div className="space-y-2">
            {privateAgents.filter(matches).map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Globe2Icon className="size-4 text-emerald-300/70" />
            <h2 className="text-xs font-medium text-zinc-300">公开 Agent</h2>
            <span className="text-[10px] text-zinc-700">{publicAgents.length}</span>
          </div>
          <div className="space-y-2">
            {publicAgents.filter(matches).map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
          {normalizedQuery && !state.agents.some(matches) && (
            <p className="mt-3 text-center text-[10px] text-zinc-700">没有匹配的 Agent</p>
          )}
        </section>
      </div>
    </div>
  );
};

const TaskBoard = ({
  state,
  onOpen,
  onStatus,
  onReview,
  onStart,
}: {
  state: TeamWorkspaceSnapshot;
  onOpen: (task: AgentTask) => void;
  onStatus: (task: AgentTask, status: TaskStatus) => void;
  onReview: (task: AgentTask, decision: "approved" | "changes_requested") => void;
  onStart: (task: AgentTask) => void;
}) => {
  const columns: Array<{ title: string; statuses: TaskStatus[] }> = [
    { title: "待审核", statuses: ["pending_review", "changes_requested"] },
    { title: "待执行", statuses: ["approved", "queued"] },
    { title: "执行中", statuses: ["running", "waiting", "blocked", "review"] },
    { title: "已结束", statuses: ["done", "failed", "cancelled"] },
  ];
  const sorted = [...state.tasks].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="electron-drag flex h-16 shrink-0 items-center justify-between border-b border-white/7 px-7">
        <div>
          <h1 className="text-sm font-semibold">Task 面板</h1>
          <p className="mt-0.5 text-[10px] text-zinc-600">
            {state.tasks.length} 个任务 · 与来源群实时关联
          </p>
        </div>
        <div className="electron-no-drag flex items-center gap-2 rounded-full border border-emerald-300/10 bg-emerald-300/5 px-3 py-1.5 text-[10px] text-emerald-300/70">
          <span className="size-1.5 rounded-full bg-emerald-300" />
          上下文订阅运行中
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-6">
        <div className="grid h-full min-w-[900px] grid-cols-4 gap-4">
          {columns.map((column) => {
            const tasks = sorted.filter((task) => column.statuses.includes(task.status));
            return (
              <section
                key={column.title}
                className="flex min-h-0 flex-col rounded-2xl border border-white/7 bg-white/[0.018]"
              >
                <header className="flex items-center justify-between border-b border-white/6 px-4 py-3">
                  <h2 className="text-xs font-medium text-zinc-400">{column.title}</h2>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-zinc-600">
                    {tasks.length}
                  </span>
                </header>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {tasks.map((task) => {
                    const room = state.rooms.find((item) => item.roomId === task.sourceRoomId);
                    const agents = state.agents.filter((agent) =>
                      task.assigneeIds.includes(agent.id),
                    );
                    const session = state.sessions
                      .filter((candidate) => candidate.taskId === task.id)
                      .sort((first, second) => second.updatedAt - first.updatedAt)[0];
                    const consumed = agents.length
                      ? Math.min(
                          ...agents.map(
                            (agent) => task.consumedContextVersionByAgent[agent.id] ?? 0,
                          ),
                        )
                      : 0;
                    const unread = Math.max(0, task.contextVersion - consumed);
                    return (
                      <article
                        key={task.id}
                        className="rounded-xl border border-white/7 bg-[#0d1119] p-3.5 transition hover:border-white/14"
                      >
                        <button
                          type="button"
                          onClick={() => onOpen(task)}
                          className="w-full text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <StatusPill status={task.status} />
                            {unread > 0 && (
                              <span className="flex items-center gap-1 text-[9px] text-cyan-300">
                                <EyeIcon className="size-3" />+{unread} 上下文
                              </span>
                            )}
                          </div>
                          <h3 className="mt-3 text-sm leading-5 text-zinc-200">{task.title}</h3>
                          <p className="mt-2 truncate text-[10px] text-zinc-600">
                            来自 # {room?.name ?? "未知群组"}
                          </p>
                          {session && (
                            <p className="mt-1 truncate font-mono text-[9px] text-zinc-700">
                              Session {sessionLabels[session.state]} · {session.provider}
                              {session.error ? ` · ${session.error}` : ""}
                            </p>
                          )}
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex -space-x-1">
                              {agents.map((agent) => (
                                <span
                                  key={agent.id}
                                  className={`grid size-6 place-items-center rounded-full border text-[8px] ${themeClasses[agent.theme].avatar}`}
                                >
                                  {agent.initials}
                                </span>
                              ))}
                            </div>
                            <span className="text-[9px] text-zinc-700">
                              {dateLabel(task.updatedAt)}
                            </span>
                          </div>
                        </button>
                        {task.status === "review" && (
                          <button
                            type="button"
                            onClick={() => onStatus(task, "done")}
                            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-300/10 py-1.5 text-[10px] text-emerald-300"
                          >
                            <CheckCircle2Icon className="size-3" />
                            验收完成
                          </button>
                        )}
                        {(task.status === "pending_review" ||
                          task.status === "changes_requested") && (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => onReview(task, "changes_requested")}
                              className="rounded-lg border border-white/8 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-200"
                            >
                              退回修改
                            </button>
                            <button
                              type="button"
                              onClick={() => onReview(task, "approved")}
                              className="rounded-lg bg-emerald-300/10 py-1.5 text-[10px] text-emerald-300"
                            >
                              审核通过
                            </button>
                          </div>
                        )}
                        {task.status === "approved" && (
                          <button
                            type="button"
                            onClick={() => onStart(task)}
                            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-300 py-1.5 text-[10px] font-medium text-cyan-950"
                          >
                            <SendIcon className="size-3" />
                            开始执行
                          </button>
                        )}
                      </article>
                    );
                  })}
                  {!tasks.length && (
                    <div className="grid h-28 place-items-center text-[10px] text-zinc-700">
                      暂无 Task
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const TeamChat = ({
  workspace,
  model,
  view,
  onViewChange,
}: {
  workspace: string;
  model?: string;
  view: TeamView;
  onViewChange: (view: TeamView) => void;
}) => {
  const [state, setState] = useState<TeamWorkspaceSnapshot | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState(LOCAL_ROOM_ID);
  const [draft, setDraft] = useState("");
  const [agentAction, setAgentAction] = useState<AgentMessageAction>("chat");
  const [mention, setMention] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | undefined>();
  const [contactSettingsOpen, setContactSettingsOpen] = useState(false);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<TeamRoomSnapshot | undefined>();
  const [imConfig, setImConfig] = useState<ImPublicConfig>(emptyImConfig);
  const [cloudMode, setCloudMode] = useState(false);
  const [connection, setConnection] = useState<OpenImConnectionState>(openImTransport.getStatus());
  const [configRevision, setConfigRevision] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => openImTransport.onStatus(setConnection), []);
  useEffect(() => {
    let cancelled = false;
    void window.agentTeam
      .getWorkspace({ workspace })
      .then((snapshot) => {
        if (!cancelled) setState(snapshot);
      })
      .catch((nextError) => setError(formatErrorMessage(nextError)));
    const unsubscribe = window.agentTeam.onEvent((event) => {
      if (
        (event.type === "workspace-snapshot" ? event.snapshot.workspace : event.workspace) !==
        workspace
      )
        return;
      setState((current) =>
        current
          ? applyEvent(current, event)
          : event.type === "workspace-snapshot"
            ? event.snapshot
            : current,
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [workspace]);

  const syncCloudWorkspace = useCallback(async () => {
    const snapshot = await window.backend.syncWorkspace({ workspace });
    setState(snapshot);
    return snapshot;
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let backendState = await window.backend.getState();
      if (!backendState.authenticated && backendState.hasRefreshToken) {
        await window.backend.request({ path: "/v1/me" }).catch(() => undefined);
        backendState = await window.backend.getState();
      }
      if (backendState.authenticated) {
        setCloudMode(true);
        try {
          const snapshot = await syncCloudWorkspace();
          if (cancelled) return;
          setSelectedRoomId((current) =>
            snapshot.rooms.some((room) => room.roomId === current)
              ? current
              : (snapshot.rooms.find((room) => room.syncSource === "backend")?.roomId ?? current),
          );
        } catch (nextError) {
          if (!cancelled) setError(formatErrorMessage(nextError));
        }
        let attempt = 0;
        const connectCloudIm = async () => {
          try {
            const runtime = await window.backend.getImRuntimeConfig();
            if (cancelled) return;
            setImConfig(runtime);
            await openImTransport.connect(runtime);
          } catch (nextError) {
            if (cancelled) return;
            const message = formatErrorMessage(nextError);
            if (message.includes("OpenIM 尚未配置")) return;
            setError(message);
            attempt += 1;
            if (attempt < 5) retryTimer = setTimeout(() => void connectCloudIm(), attempt * 1_500);
          }
        };
        await connectCloudIm();
        return;
      }
      const config = await window.im.getConfig();
      if (cancelled) return;
      setCloudMode(false);
      setImConfig(config);
      if (
        config.apiAddr &&
        config.wsAddr &&
        config.userId &&
        config.groupId &&
        config.hasUserToken
      ) {
        try {
          await openImTransport.connect(await window.im.getRuntimeConfig());
          for (const message of await openImTransport.loadHistory(config.groupId)) {
            await window.agentTeam.ingestExternalMessage({ workspace, message });
          }
          if (!cancelled) setSelectedRoomId(config.groupId);
        } catch {
          // Sanitized transport error is exposed through its status event.
        }
      } else {
        await openImTransport.connect({
          ...config,
          userToken: "",
          dataDir: "",
          platformId: 4,
        });
      }
    })().catch((nextError) => {
      if (!cancelled) setError(formatErrorMessage(nextError));
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [configRevision, syncCloudWorkspace, workspace]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.backend.onEvent((event) => {
      const type = String(event.type ?? "");
      if (type === "auth.changed") {
        setConfigRevision((value) => value + 1);
        return;
      }
      if (
        !type.startsWith("friend") &&
        !type.startsWith("room.") &&
        !type.startsWith("message.") &&
        !type.startsWith("task.") &&
        !type.startsWith("agent.")
      ) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void syncCloudWorkspace().catch((nextError) => setError(formatErrorMessage(nextError)));
      }, 350);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [syncCloudWorkspace]);

  useEffect(
    () =>
      openImTransport.onMessage((message) => {
        if (message.conversationType === "direct" && message.principalId) {
          void (async () => {
            try {
              const principal =
                state?.humans.find(
                  (human) =>
                    human.openimUserId === message.principalId || human.id === message.principalId,
                )?.id ?? message.principalId!;
              const existing = state?.rooms.find(
                (candidate) =>
                  candidate.type === "direct" && candidate.directPrincipalId === principal,
              );
              const directRoom = await window.agentTeam.openDirectRoom({
                workspace,
                principalId: principal,
              });
              await window.agentTeam.ingestExternalMessage({
                workspace,
                message: { ...message, roomId: existing?.roomId ?? directRoom.roomId },
              });
            } catch (nextError) {
              setError(formatErrorMessage(nextError));
            }
          })();
          return;
        }
        const mappedRoom = state?.rooms.find(
          (candidate) =>
            candidate.externalId === message.roomId || candidate.roomId === message.roomId,
        );
        if (!mappedRoom && message.roomId !== imConfig.groupId) return;
        void window.agentTeam.ingestExternalMessage({
          workspace,
          message: { ...message, roomId: mappedRoom?.roomId ?? message.roomId },
          model,
          triggerAgents:
            !mappedRoom?.syncSource &&
            imConfig.hostRemoteMessages &&
            message.senderId !== "local_user",
        });
      }),
    [imConfig.groupId, imConfig.hostRemoteMessages, model, state, workspace],
  );

  const room =
    state?.rooms.find((candidate) => candidate.roomId === selectedRoomId) ??
    state?.rooms.find((candidate) => candidate.type === "group");
  const task = room?.taskId
    ? state?.tasks.find((candidate) => candidate.id === room.taskId)
    : undefined;
  const sourceRoom = task
    ? state?.rooms.find((candidate) => candidate.roomId === task.sourceRoomId)
    : undefined;
  const roomAgents = state?.agents.filter((agent) => room?.agentIds.includes(agent.id)) ?? [];
  const roomHumans = state?.humans.filter((human) => room?.humanIds.includes(human.id)) ?? [];
  const mentionCandidates = buildMentionCandidates(roomAgents, roomHumans);
  const mentionedTargets = mentionedCandidates(mentionCandidates, draft);
  const mentionsAllAgents = /@(所有Agent|全部Agent|all-agents|all)(?=\s|$)/i.test(draft);
  const mentionedAgents = mentionsAllAgents
    ? roomAgents
    : mentionedTargets
        .filter((candidate) => candidate.kind === "agent")
        .map((candidate) => roomAgents.find((agent) => agent.id === candidate.id))
        .filter((agent): agent is AgentDefinition => Boolean(agent));
  const mentionedHumans = mentionedTargets
    .filter((candidate) => candidate.kind === "human")
    .map((candidate) => roomHumans.find((human) => human.id === candidate.id))
    .filter((human): human is HumanContact => Boolean(human));
  const filteredMentionCandidates = mention
    ? mentionCandidates
        .filter((candidate) => {
          const query = mention.query.toLocaleLowerCase();
          return [candidate.name, candidate.title, candidate.mention.slice(1), candidate.id].some(
            (value) => value.toLocaleLowerCase().includes(query),
          );
        })
        .slice(0, 8)
    : [];
  const directAgent = state?.agents.find((agent) => agent.id === room?.directPrincipalId);
  const directHuman = state?.humans.find((human) => human.id === room?.directPrincipalId);
  const roomTasks =
    state?.tasks
      .filter((candidate) => candidate.sourceRoomId === room?.roomId)
      .sort((a, b) => b.updatedAt - a.updatedAt) ?? [];
  const roomLoops =
    state?.loops
      .filter((candidate) => candidate.roomId === room?.roomId)
      .sort((a, b) => b.updatedAt - a.updatedAt) ?? [];
  const visibleLoop =
    roomLoops.find(
      (candidate) => candidate.status === "running" || candidate.status === "paused",
    ) ?? roomLoops[0];
  const sourceContext =
    task && sourceRoom
      ? task.contextEvents
          .map((context) => sourceRoom.messages.find((message) => message.id === context.messageId))
          .filter((message): message is TeamMessage => Boolean(message))
          .slice(-8)
      : [];
  const runningCount =
    task?.runs.filter((run) => run.status === "pending" || run.status === "streaming").length ??
    room?.messages.filter(
      (message) => message.status === "pending" || message.status === "streaming",
    ).length ??
    0;

  useEffect(() => {
    setAgentAction("chat");
    setMention(null);
  }, [selectedRoomId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [room?.messages]);

  useEffect(() => {
    if (connection.state !== "connected" || !room?.externalId) return;
    let cancelled = false;
    void openImTransport
      .loadHistory(room.externalId)
      .then(async (messages) => {
        for (const message of messages) {
          if (cancelled) return;
          await window.agentTeam.ingestExternalMessage({
            workspace,
            message: { ...message, roomId: room.roomId },
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection.state, room?.externalId, room?.roomId, workspace]);

  const openTask = (nextTask: AgentTask) => {
    setSelectedRoomId(nextTask.taskRoomId);
    onViewChange("messages");
  };
  const updateMention = (value: string, caret: number) => {
    if (room?.type === "direct" || (!roomAgents.length && !roomHumans.length)) {
      setMention(null);
      return;
    }
    const match = value.slice(0, caret).match(/@([^\s@]*)$/u);
    if (!match) {
      setMention(null);
      return;
    }
    setMention({ start: caret - match[0].length, end: caret, query: match[1] });
    setMentionIndex(0);
  };
  const insertMention = (candidate: MentionCandidate) => {
    if (!mention) return;
    const insertion = `${candidate.mention} `;
    const value = `${draft.slice(0, mention.start)}${insertion}${draft.slice(mention.end)}`;
    const caret = mention.start + insertion.length;
    setDraft(value);
    setMention(null);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(caret, caret);
    });
  };
  const openDirect = async (principalId: string) => {
    try {
      const human = state?.humans.find((candidate) => candidate.id === principalId);
      const agent = state?.agents.find((candidate) => candidate.id === principalId);
      let nextRoom: TeamRoomSnapshot;
      if (
        cloudMode &&
        (human?.syncSource === "backend" ||
          agent?.syncSource === "backend" ||
          Boolean(agent?.cloudAgentId))
      ) {
        const created = await window.backend.request<{ id: string }>({
          method: "POST",
          path: agent ? "/v1/rooms/agent-direct" : "/v1/rooms/direct",
          body: agent ? { agentId: agent.cloudAgentId ?? principalId } : { userId: principalId },
        });
        const snapshot = await syncCloudWorkspace();
        const syncedRoom = snapshot.rooms.find((candidate) => candidate.roomId === created.id);
        if (!syncedRoom) throw new Error("云端私聊已创建，但同步结果中没有对应会话。");
        nextRoom = syncedRoom;
      } else {
        nextRoom = await window.agentTeam.openDirectRoom({ workspace, principalId });
      }
      setState((current) =>
        current ? { ...current, rooms: upsertRoom(current.rooms, nextRoom) } : current,
      );
      setSelectedRoomId(nextRoom.roomId);
      onViewChange("messages");
      if (connection.state === "connected" && human && human.id !== "local_user") {
        for (const message of await openImTransport.loadDirectHistory(
          human.openimUserId ?? principalId,
        )) {
          await window.agentTeam.ingestExternalMessage({
            workspace,
            message: { ...message, roomId: nextRoom.roomId },
          });
        }
      }
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !room) return;
    if (room.type !== "direct" && agentAction === "propose-task" && !mentionedAgents.length) {
      setError("请先在消息中 @ 一个负责规划的 Agent。");
      return;
    }
    setSending(true);
    setError("");
    setDraft("");
    try {
      if (connection.state === "connected" && room.syncSource === "backend" && room.externalId) {
        const targetOpenimIds = roomAgents
          .filter(
            (agent) =>
              mentionedAgents.some((mentioned) => mentioned.id === agent.id) ||
              (room.type === "direct" && room.directPrincipalId === agent.id),
          )
          .map((agent) => agent.openimUserId)
          .filter((id): id is string => Boolean(id));
        targetOpenimIds.push(
          ...roomHumans
            .filter(
              (human) =>
                mentionedHumans.some((mentioned) => mentioned.id === human.id) ||
                (room.type === "direct" && room.directPrincipalId === human.id),
            )
            .map((human) => human.openimUserId)
            .filter((id): id is string => Boolean(id)),
        );
        const message = await openImTransport.sendText(
          text,
          undefined,
          room.externalId,
          targetOpenimIds,
          { agentAction },
        );
        await window.agentTeam.ingestExternalMessage({
          workspace,
          message: { ...message, roomId: room.roomId, agentAction },
          agentAction,
        });
      } else if (
        connection.state === "connected" &&
        room.type === "group" &&
        room.roomId === imConfig.groupId
      ) {
        const targetOpenimIds = roomAgents
          .filter((agent) => mentionedAgents.some((mentioned) => mentioned.id === agent.id))
          .map((agent) => agent.openimUserId)
          .filter((id): id is string => Boolean(id));
        targetOpenimIds.push(
          ...mentionedHumans
            .map((human) => human.openimUserId)
            .filter((id): id is string => Boolean(id)),
        );
        const message = await openImTransport.sendText(
          text,
          undefined,
          imConfig.groupId,
          targetOpenimIds,
          { agentAction },
        );
        await window.agentTeam.ingestExternalMessage({
          workspace,
          message: { ...message, agentAction },
          model,
          targetAgentIds: mentionedAgents.map((agent) => agent.id),
          triggerAgents: true,
          agentAction,
        });
      } else if (connection.state === "connected" && room.type === "direct" && directHuman) {
        const message = await openImTransport.sendText(
          text,
          directHuman.openimUserId ?? directHuman.id,
        );
        await window.agentTeam.ingestExternalMessage({
          workspace,
          message: { ...message, roomId: room.roomId },
        });
      } else {
        await window.agentTeam.sendMessage({
          workspace,
          roomId: room.roomId,
          text,
          model,
          targetAgentIds: mentionedAgents.map((agent) => agent.id),
          agentAction,
        });
      }
      setAgentAction("chat");
      setMention(null);
    } catch (nextError) {
      setDraft(text);
      setError(formatErrorMessage(nextError));
    } finally {
      setSending(false);
    }
  };
  const updateTaskStatus = async (nextTask: AgentTask, status: TaskStatus) => {
    try {
      if (nextTask.syncSource === "backend") {
        await window.backend.request({
          method: "PATCH",
          path: `/v1/tasks/${encodeURIComponent(nextTask.id)}/status`,
          body: { status },
        });
        await syncCloudWorkspace();
      } else {
        await window.agentTeam.updateTaskStatus({ workspace, taskId: nextTask.id, status });
      }
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const reviewTask = async (nextTask: AgentTask, decision: "approved" | "changes_requested") => {
    try {
      setError("");
      if (nextTask.syncSource === "backend") {
        await window.backend.request({
          method: "POST",
          path: `/v1/tasks/${encodeURIComponent(nextTask.id)}/reviews`,
          headers: { "if-match": String(nextTask.revision) },
          body: {
            decision,
            comment:
              decision === "approved"
                ? "已人工审核任务目标、执行计划和权限。"
                : "请根据沟通内容修改任务计划后再次提交审核。",
          },
        });
        await syncCloudWorkspace();
      } else {
        await window.agentTeam.reviewTask({
          workspace,
          taskId: nextTask.id,
          decision,
          comment:
            decision === "approved"
              ? "已人工审核任务目标、执行计划和权限。"
              : "请根据沟通内容修改任务计划后再次提交审核。",
        });
      }
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const startTask = async (nextTask: AgentTask) => {
    try {
      setError("");
      if (nextTask.syncSource === "backend") {
        await window.backend.request({
          method: "POST",
          path: `/v1/tasks/${encodeURIComponent(nextTask.id)}/start`,
          headers: { "if-match": String(nextTask.revision) },
        });
        await syncCloudWorkspace();
      } else {
        await window.agentTeam.startTask({ workspace, taskId: nextTask.id, model });
      }
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };
  const controlLoop = async (nextLoop: AgentLoopSession, action: "pause" | "resume" | "cancel") => {
    try {
      setError("");
      await window.agentTeam.controlLoop({
        workspace,
        loopId: nextLoop.id,
        action,
        model,
      });
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    }
  };

  if (!state)
    return (
      <div className="grid h-full place-items-center">
        <LoaderCircleIcon className="size-6 animate-spin text-cyan-300" />
      </div>
    );
  if (view === "contacts")
    return (
      <div className="relative h-full">
        <ContactsView
          state={state}
          onEditAgents={(agentId) => {
            setEditingAgentId(agentId);
            setAgentSettingsOpen(true);
          }}
          onEditHumans={() => setContactSettingsOpen(true)}
          onOpenDirect={(principalId) => void openDirect(principalId)}
        />
        {agentSettingsOpen && (
          <AgentSettings
            workspace={workspace}
            agents={state.agents}
            initialAgentId={editingAgentId}
            cloudMode={cloudMode}
            syncCloudWorkspace={syncCloudWorkspace}
            onClose={() => setAgentSettingsOpen(false)}
            onSaved={setState}
          />
        )}
        {contactSettingsOpen && (
          <ContactSettings
            workspace={workspace}
            humans={state.humans}
            cloudMode={cloudMode}
            syncCloudWorkspace={syncCloudWorkspace}
            onClose={() => setContactSettingsOpen(false)}
            onSaved={setState}
          />
        )}
      </div>
    );
  if (view === "tasks")
    return (
      <TaskBoard
        state={state}
        onOpen={openTask}
        onStatus={(nextTask, status) => void updateTaskStatus(nextTask, status)}
        onReview={(nextTask, decision) => void reviewTask(nextTask, decision)}
        onStart={(nextTask) => void startTask(nextTask)}
      />
    );

  const conversations = [...state.rooms].sort((a, b) => {
    const activityA = a.messages.at(-1)?.updatedAt ?? a.createdAt;
    const activityB = b.messages.at(-1)?.updatedAt ?? b.createdAt;
    return activityB - activityA;
  });
  return (
    <div className="relative flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/7 bg-[#0b0e15]/75">
        <header className="electron-drag flex h-16 items-center justify-between border-b border-white/7 px-4">
          <div>
            <div className="text-xs font-medium text-zinc-300">消息</div>
            <div className="mt-0.5 text-[9px] text-zinc-600">全部会话按最近消息排序</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingRoom(undefined);
              setRoomDialogOpen(true);
            }}
            className="electron-no-drag grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
            title="新建群组"
          >
            <PlusIcon className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="text-[9px] tracking-[0.14em] text-zinc-700 uppercase">最近会话</span>
            <span className="text-[9px] text-zinc-700">{conversations.length}</span>
          </div>
          <div className="space-y-1">
            {conversations.map((item) => {
              const itemTask = state.tasks.find((candidate) => candidate.id === item.taskId);
              const itemAgent = state.agents.find(
                (candidate) => candidate.id === item.directPrincipalId,
              );
              const isSelected = room?.roomId === item.roomId;
              return (
                <button
                  key={item.roomId}
                  type="button"
                  onClick={() => setSelectedRoomId(item.roomId)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left ${isSelected ? (item.type === "task" ? "bg-violet-300/8 text-violet-100" : "bg-cyan-300/8 text-cyan-100") : "text-zinc-500 hover:bg-white/4"}`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-xl ${item.type === "task" ? "bg-violet-300/7 text-violet-300" : item.type === "direct" ? "bg-cyan-300/7 text-cyan-300" : "bg-white/5"}`}
                  >
                    {item.type === "task" ? (
                      <FolderKanbanIcon className="size-3.5" />
                    ) : item.type === "direct" ? (
                      itemAgent ? (
                        <BotIcon className="size-3.5" />
                      ) : (
                        <MessageSquareMoreIcon className="size-3.5" />
                      )
                    ) : (
                      <UsersIcon className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{item.name}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-zinc-700">
                      {item.type === "task" && itemTask ? (
                        <StatusPill status={itemTask.status} />
                      ) : item.type === "direct" ? (
                        itemAgent ? (
                          "Agent 私聊"
                        ) : (
                          "好友私聊"
                        )
                      ) : (
                        `${item.agentIds.length + item.humanIds.length} 位成员`
                      )}
                    </span>
                  </span>
                  {item.messages.length > 0 && (
                    <span className="shrink-0 text-[8px] text-zinc-700">
                      {timeLabel(item.messages.at(-1)?.updatedAt ?? item.createdAt)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="electron-drag flex h-16 shrink-0 items-center justify-between border-b border-white/7 px-5">
          <div className="flex min-w-0 items-center gap-3">
            {room?.type === "task" && (
              <button
                type="button"
                onClick={() => sourceRoom && setSelectedRoomId(sourceRoom.roomId)}
                className="electron-no-drag grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-white"
              >
                <ArrowLeftIcon className="size-4" />
              </button>
            )}
            <div
              className={`grid size-8 shrink-0 place-items-center rounded-xl ${room?.type === "task" ? "bg-violet-300/8 text-violet-300" : "bg-cyan-300/8 text-cyan-300"}`}
            >
              {room?.type === "task" ? (
                <FolderKanbanIcon className="size-4" />
              ) : room?.type === "direct" ? (
                directAgent ? (
                  <BotIcon className="size-4" />
                ) : (
                  <MessageSquareMoreIcon className="size-4" />
                )
              ) : (
                <UsersIcon className="size-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-medium text-zinc-200">{room?.name}</h1>
                {task && <StatusPill status={task.status} />}
                {runningCount > 0 && (
                  <span className="text-[9px] text-cyan-300">{runningCount} 个运行中</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <ConnectionBadge status={connection} />
                {room?.type === "task" && sourceRoom && (
                  <span className="text-[9px] text-zinc-600">关联 # {sourceRoom.name}</span>
                )}
              </div>
            </div>
          </div>
          <div className="electron-no-drag flex items-center gap-1">
            {room &&
              room.type !== "direct" &&
              (room.syncSource !== "backend" ||
                (room.type === "group" && room.ownerId === "local_user")) && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRoom(room);
                    setRoomDialogOpen(true);
                  }}
                  className="grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
                  title={room.type === "task" ? "管理 Task 小群成员" : "管理群成员"}
                >
                  <UserRoundCogIcon className="size-4" />
                </button>
              )}
            {room?.type === "group" && room.syncSource !== "backend" && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
                title="OpenIM 设置"
              >
                <Settings2Icon className="size-4" />
              </button>
            )}
          </div>
        </header>
        {visibleLoop && room?.type !== "task" && (
          <div className="border-b border-cyan-300/8 bg-cyan-300/[0.025] px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-cyan-300/8 text-cyan-300">
                <Repeat2Icon
                  className={`size-4 ${visibleLoop.status === "running" ? "animate-pulse" : ""}`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-xs text-zinc-300">{visibleLoop.title}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] ${
                      visibleLoop.status === "running"
                        ? "border-cyan-300/15 bg-cyan-300/8 text-cyan-300"
                        : visibleLoop.status === "paused"
                          ? "border-amber-300/15 bg-amber-300/8 text-amber-300"
                          : visibleLoop.status === "completed"
                            ? "border-emerald-300/15 bg-emerald-300/8 text-emerald-300"
                            : "border-white/8 bg-white/4 text-zinc-500"
                    }`}
                  >
                    {visibleLoop.status === "running"
                      ? "运行中"
                      : visibleLoop.status === "paused"
                        ? "已暂停"
                        : visibleLoop.status === "completed"
                          ? "已完成"
                          : visibleLoop.status === "cancelled"
                            ? "已终止"
                            : "失败"}
                  </span>
                  <span className="text-[9px] text-zinc-600">
                    {visibleLoop.completedTurns}
                    {visibleLoop.targetTurns ? ` / ${visibleLoop.targetTurns}` : " 次回复"}
                  </span>
                </div>
                <p className="mt-1 truncate text-[10px] text-zinc-600">
                  {visibleLoop.endReason || visibleLoop.objective}
                </p>
                {visibleLoop.targetTurns && (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-cyan-300/70 transition-[width]"
                      style={{
                        width: `${Math.min(100, (visibleLoop.completedTurns / visibleLoop.targetTurns) * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {visibleLoop.status === "running" && (
                  <button
                    type="button"
                    onClick={() => void controlLoop(visibleLoop, "pause")}
                    className="grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-amber-300"
                    title="暂停 Loop"
                  >
                    <PauseIcon className="size-3.5" />
                  </button>
                )}
                {visibleLoop.status === "paused" && (
                  <button
                    type="button"
                    onClick={() => void controlLoop(visibleLoop, "resume")}
                    className="grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-white/5 hover:text-cyan-300"
                    title="继续 Loop"
                  >
                    <PlayIcon className="size-3.5" />
                  </button>
                )}
                {(visibleLoop.status === "running" || visibleLoop.status === "paused") && (
                  <button
                    type="button"
                    onClick={() => void controlLoop(visibleLoop, "cancel")}
                    className="grid size-8 place-items-center rounded-lg text-zinc-600 hover:bg-red-300/5 hover:text-red-300"
                    title="终止 Loop"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {task && sourceRoom && (
          <div className="border-b border-violet-300/8 bg-violet-300/[0.025] px-5 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-violet-300/8 text-violet-300">
                <MessageSquareMoreIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={task.status} />
                  <span className="truncate text-xs text-zinc-300">{task.title}</span>
                  <span className="text-[9px] text-zinc-700">v{task.revision}</span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-zinc-500">{task.objective}</p>
                {!!task.plan.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {task.plan.map((step, index) => (
                      <span
                        key={`${index}-${step}`}
                        className="rounded-md border border-white/6 bg-black/15 px-2 py-1 text-[9px] text-zinc-500"
                      >
                        {index + 1}. {step}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-zinc-600">
                  <span>
                    来源：{sourceRoom.name} · 消息 #{task.anchorSeq}
                  </span>
                  <span>权限：{task.requestedAccess === "write" ? "读写工作区" : "只读分析"}</span>
                  {task.reviews.at(-1) && (
                    <span>
                      最近审核：{task.reviews.at(-1)?.reviewerName} ·{" "}
                      {dateLabel(task.reviews.at(-1)!.reviewedAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {(task.status === "pending_review" || task.status === "changes_requested") && (
                  <>
                    <button
                      type="button"
                      onClick={() => void reviewTask(task, "changes_requested")}
                      className="rounded-lg border border-white/8 px-2.5 py-1.5 text-[9px] text-zinc-500 hover:text-zinc-200"
                    >
                      退回修改
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewTask(task, "approved")}
                      className="rounded-lg bg-emerald-300/10 px-2.5 py-1.5 text-[9px] text-emerald-300"
                    >
                      审核通过
                    </button>
                  </>
                )}
                {task.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => void startTask(task)}
                    className="rounded-lg bg-cyan-300 px-2.5 py-1.5 text-[9px] font-medium text-cyan-950"
                  >
                    开始执行
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRoomId(sourceRoom.roomId)}
                  className="px-1 text-[9px] text-violet-300/70 hover:text-violet-200"
                >
                  查看主群
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-4xl">
            {!room?.messages.length && (
              <div className="grid min-h-[46vh] place-items-center text-center">
                <div className="max-w-md">
                  <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-cyan-300/12 bg-cyan-300/7 text-cyan-300">
                    <BotIcon className="size-5" />
                  </div>
                  <h2 className="mt-5 text-base font-semibold text-zinc-200">
                    {room?.type === "task"
                      ? "Task 小群已建立"
                      : room?.type === "direct"
                        ? `开始和 ${room.name} 私聊`
                        : "从一条群消息开始"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    {room?.type === "task"
                      ? "在这里继续讨论细节；Agent 会持续看到来源群的新消息，审核通过前不会执行。"
                      : room?.type === "direct"
                        ? directAgent
                          ? "直接发送消息即可连续对话；这里的消息不会自动创建 Task。"
                          : "发送一条消息，开始一对一好友会话。"
                        : "普通 @ 只会让 Agent 在群里回复；需要执行工作时切换到“规划 Task”。"}
                  </p>
                </div>
              </div>
            )}
            {room?.messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                agent={state.agents.find((agent) => agent.id === message.senderId)}
                task={
                  message.taskId
                    ? state.tasks.find((candidate) => candidate.id === message.taskId)
                    : undefined
                }
                onStop={(runId) => void window.agentTeam.stopRun({ runId }).catch(() => undefined)}
                onOpenTask={openTask}
              />
            ))}
            <div ref={endRef} />
          </div>
        </div>
        <footer className="shrink-0 border-t border-white/7 bg-[#080b12]/92 px-6 py-4 backdrop-blur-xl">
          <div className="mx-auto max-w-4xl">
            {room?.type === "direct" ? (
              <div className="mb-2 text-[9px] text-zinc-700">
                {directAgent ? "Agent 会在当前私聊中自动回复" : "好友私聊"}
              </div>
            ) : (
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[9px] text-zinc-600">
                  <span className="rounded-md border border-white/7 bg-white/[0.025] px-2 py-1 font-medium text-zinc-400">
                    @
                  </span>
                  <span>在消息栏输入 @ 选择 Agent，可连续提及多个</span>
                  {!!mentionedAgents.length && (
                    <span className="truncate text-cyan-300/75">
                      将通知：{mentionedAgents.map((agent) => agent.name).join("、")}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 rounded-lg border border-white/7 bg-black/20 p-0.5">
                  <button
                    type="button"
                    onClick={() => setAgentAction("chat")}
                    className={`rounded-md px-2.5 py-1 text-[9px] transition ${
                      agentAction === "chat"
                        ? "bg-white/8 text-zinc-200"
                        : "text-zinc-600 hover:text-zinc-300"
                    }`}
                  >
                    群聊回复
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgentAction("propose-task")}
                    className={`rounded-md px-2.5 py-1 text-[9px] transition ${
                      agentAction === "propose-task"
                        ? "bg-violet-300/12 text-violet-200"
                        : "text-zinc-600 hover:text-zinc-300"
                    }`}
                  >
                    规划 Task
                  </button>
                </div>
              </div>
            )}
            <div className="relative rounded-2xl border border-white/9 bg-white/[0.035] p-2 shadow-xl shadow-black/10 focus-within:border-cyan-300/20">
              {mention && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#111620] p-1.5 shadow-2xl shadow-black/50">
                  <div className="px-2 py-1.5 text-[9px] tracking-[0.12em] text-zinc-600 uppercase">
                    {mention.query ? `搜索 “${mention.query}”` : "选择要提及的成员"}
                  </div>
                  {filteredMentionCandidates.map((candidate, index) => {
                    const theme = candidate.theme ? themeClasses[candidate.theme] : undefined;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertMention(candidate)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition ${
                          index === mentionIndex ? "bg-white/8" : "hover:bg-white/5"
                        }`}
                      >
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-lg border text-[9px] ${theme?.avatar ?? "border-white/9 bg-white/5 text-zinc-300"}`}
                        >
                          {candidate.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-xs text-zinc-300">
                            {candidate.name}
                            <span className="text-[9px] text-zinc-600">{candidate.mention}</span>
                          </span>
                          <span className="block truncate text-[9px] text-zinc-600">
                            {candidate.title}
                            {candidate.description ? ` · ${candidate.description}` : " · 好友"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {!filteredMentionCandidates.length && (
                    <div className="px-2 py-3 text-[10px] text-zinc-600">
                      当前群里没有匹配的成员
                    </div>
                  )}
                  {!!filteredMentionCandidates.length && (
                    <div className="border-t border-white/6 px-2 pt-1.5 text-[8px] text-zinc-700">
                      ↑↓ 选择 · Enter 插入 · Esc 关闭
                    </div>
                  )}
                </div>
              )}
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  updateMention(event.target.value, event.currentTarget.selectionStart);
                }}
                onClick={(event) =>
                  updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
                }
                onSelect={(event) =>
                  updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
                }
                onKeyDown={(event) => {
                  if (mention && filteredMentionCandidates.length) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMentionIndex((index) => (index + 1) % filteredMentionCandidates.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionIndex(
                        (index) =>
                          (index - 1 + filteredMentionCandidates.length) %
                          filteredMentionCandidates.length,
                      );
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      insertMention(
                        filteredMentionCandidates[mentionIndex] ?? filteredMentionCandidates[0],
                      );
                      return;
                    }
                  }
                  if (event.key === "Escape" && mention) {
                    event.preventDefault();
                    setMention(null);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={
                  room?.type === "group"
                    ? agentAction === "propose-task"
                      ? "描述需要完成的工作，Agent 将整理目标和执行计划供你审核…"
                      : "发消息或 @ Agent 对话；不会自动创建 Task…"
                    : room?.type === "task"
                      ? agentAction === "propose-task"
                        ? "要求 Agent 根据讨论修改 Task 计划并重新提交审核…"
                        : "讨论任务细节；消息会更新上下文，但不会立即执行…"
                      : `给 ${room?.name ?? "联系人"} 发消息…`
                }
                className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-700"
              />
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-[9px] text-zinc-700">
                  {room?.type === "direct"
                    ? directAgent
                      ? "连续 Agent 会话，不创建 Task"
                      : "一对一好友消息"
                    : agentAction === "propose-task"
                      ? mentionedAgents.length
                        ? "Agent 只生成或修改 Task 草案；人工审核后才能开始执行"
                        : "请先在消息中 @ 一个负责规划的 Agent"
                      : mentionedAgents.length
                        ? "Agent 在当前会话回复；不会创建或启动 Task"
                        : "输入 @ 提及 Agent；未提及时只发送普通消息"}
                </span>
                <button
                  type="button"
                  disabled={
                    sending ||
                    !draft.trim() ||
                    (room?.type !== "direct" &&
                      agentAction === "propose-task" &&
                      !mentionedAgents.length)
                  }
                  onClick={() => void send()}
                  className="grid size-8 place-items-center rounded-xl bg-cyan-300 text-cyan-950 disabled:opacity-30"
                >
                  {sending ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : (
                    <SendIcon className="size-4" />
                  )}
                </button>
              </div>
            </div>
            {error && <p className="mt-2 text-[10px] text-red-300/80">{error}</p>}
          </div>
        </footer>
      </section>

      <aside className="hidden w-64 shrink-0 border-l border-white/7 bg-[#0b0e15]/65 xl:flex xl:flex-col">
        <div className="border-b border-white/7 px-4 py-[22px] text-[10px] font-medium tracking-[0.16em] text-zinc-600 uppercase">
          {room?.type === "task" ? "实时上下文" : room?.type === "direct" ? "联系人" : "群内工作"}
        </div>
        {room?.type === "group" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-2 px-2 text-[9px] text-zinc-700 uppercase">Agent 成员</div>
            {roomAgents.map((agent) => {
              const active = state.tasks.some(
                (candidate) =>
                  candidate.assigneeIds.includes(agent.id) && candidate.status === "running",
              );
              return (
                <div key={agent.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                  <div
                    className={`grid size-8 place-items-center rounded-xl border text-xs ${themeClasses[agent.theme].avatar}`}
                  >
                    {agent.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-zinc-300">{agent.name}</div>
                    <div className="mt-0.5 text-[9px] text-zinc-600">
                      {active
                        ? "正在工作"
                        : agent.visibility === "public"
                          ? "公开 Agent"
                          : "私有 Agent"}
                    </div>
                  </div>
                  <span
                    className={`size-1.5 rounded-full ${active ? "animate-pulse bg-cyan-300" : "bg-emerald-300/70"}`}
                  />
                </div>
              );
            })}
            <div className="mt-4 mb-2 px-2 text-[9px] text-zinc-700 uppercase">好友成员</div>
            {roomHumans.map((human) => (
              <div key={human.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                <div className="grid size-8 place-items-center rounded-xl border border-white/9 bg-white/5 text-xs">
                  {human.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-zinc-300">{human.name}</div>
                  <div className="mt-0.5 text-[9px] text-zinc-600">{human.title}</div>
                </div>
                <span
                  className={`size-1.5 rounded-full ${human.status === "online" ? "bg-emerald-300" : "bg-zinc-700"}`}
                />
              </div>
            ))}
            <div className="mt-5 mb-2 flex items-center justify-between px-2">
              <span className="text-[9px] text-zinc-700 uppercase">关联 Task</span>
              <button
                type="button"
                onClick={() => onViewChange("tasks")}
                className="text-[9px] text-cyan-300/60"
              >
                查看全部
              </button>
            </div>
            {roomTasks.slice(0, 8).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openTask(item)}
                className="mb-2 w-full rounded-xl border border-white/6 bg-white/[0.02] p-3 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusPill status={item.status} />
                  <span className="text-[9px] text-zinc-700">{timeLabel(item.updatedAt)}</span>
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">
                  {item.title}
                </div>
              </button>
            ))}
          </div>
        ) : room?.type === "task" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="rounded-xl border border-violet-300/10 bg-violet-300/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-violet-200">
                  上下文版本 {task?.contextVersion}
                </span>
                {task && <StatusPill status={task.status} />}
              </div>
              <p className="mt-2 text-[10px] leading-5 text-zinc-600">
                这些是主群持续同步到当前 Task 的消息引用。
              </p>
            </div>
            <div className="mt-4 space-y-2">
              {sourceContext.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => sourceRoom && setSelectedRoomId(sourceRoom.roomId)}
                  className="w-full rounded-xl border border-white/6 bg-white/[0.02] p-3 text-left"
                >
                  <div className="flex items-center justify-between text-[9px] text-zinc-700">
                    <span>
                      {message.senderName} · #{message.seq}
                    </span>
                    <span>{timeLabel(message.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[10px] leading-5 text-zinc-500">
                    {message.content}
                  </p>
                </button>
              ))}
            </div>
            {task && (
              <div className="mt-4 flex gap-2">
                {task.status === "review" && (
                  <button
                    type="button"
                    onClick={() => void updateTaskStatus(task, "done")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-300/10 py-2 text-[10px] text-emerald-300"
                  >
                    <CheckCircle2Icon className="size-3" />
                    验收
                  </button>
                )}
                {activeTaskStatuses.includes(task.status) && task.status !== "waiting" && (
                  <button
                    type="button"
                    onClick={() => void updateTaskStatus(task, "waiting")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-300/8 py-2 text-[10px] text-amber-300"
                  >
                    <Clock3Icon className="size-3" />
                    等待
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="rounded-2xl border border-white/7 bg-white/[0.025] p-4 text-center">
              <div
                className={`mx-auto grid size-14 place-items-center rounded-2xl border text-base ${directAgent ? themeClasses[directAgent.theme].avatar : "border-white/10 bg-white/5 text-zinc-300"}`}
              >
                {directAgent?.initials ?? directHuman?.initials ?? "?"}
              </div>
              <div className="mt-3 text-sm text-zinc-200">
                {directAgent?.name ?? directHuman?.name ?? room?.name}
              </div>
              <div className="mt-1 text-[10px] text-zinc-600">
                {directAgent
                  ? `${directAgent.title} · ${directAgent.executionLocation === "local" ? "本机运行" : "托管运行"}`
                  : (directHuman?.title ?? "好友")}
              </div>
              {directAgent && (
                <>
                  <p className="mt-4 text-left text-xs leading-5 text-zinc-500">
                    {directAgent.description}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-zinc-500">
                      {directAgent.visibility === "public" ? "公开 Agent" : "私有 Agent"}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-zinc-500">
                      {directAgent.workspaceAccess === "write" ? "工作区可写" : "只读"}
                    </span>
                  </div>
                </>
              )}
            </div>
            <p className="mt-4 text-[10px] leading-5 text-zinc-700">
              {directAgent
                ? "当前私聊使用独立的连续 Codex 上下文，不会混入群聊或自动创建 Task。"
                : "这是好友的一对一会话，所有私聊都会保留在左侧消息列表中。"}
            </p>
          </div>
        )}
      </aside>

      {settingsOpen && (
        <ImSettings
          config={imConfig}
          onClose={() => setSettingsOpen(false)}
          onSaved={(config) => {
            setImConfig(config);
            setConfigRevision((value) => value + 1);
          }}
        />
      )}
      {agentSettingsOpen && (
        <AgentSettings
          workspace={workspace}
          agents={state.agents}
          initialAgentId={editingAgentId}
          cloudMode={cloudMode}
          syncCloudWorkspace={syncCloudWorkspace}
          onClose={() => setAgentSettingsOpen(false)}
          onSaved={setState}
        />
      )}
      {roomDialogOpen && (
        <RoomDialog
          workspace={workspace}
          room={editingRoom}
          agents={state.agents}
          humans={state.humans}
          cloudMode={cloudMode}
          syncCloudWorkspace={syncCloudWorkspace}
          onClose={() => setRoomDialogOpen(false)}
          onSaved={(nextRoom) => {
            setState((current) =>
              current ? { ...current, rooms: upsertRoom(current.rooms, nextRoom) } : current,
            );
            setSelectedRoomId(nextRoom.roomId);
          }}
        />
      )}
    </div>
  );
};
