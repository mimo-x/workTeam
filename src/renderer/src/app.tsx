import { AssistantRuntimeProvider, type ThreadMessageLike } from "@assistant-ui/react";
import {
  ArchiveIcon,
  BookUserIcon,
  BotIcon,
  CircleAlertIcon,
  CommandIcon,
  CloudIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LogInIcon,
  MessageSquareIcon,
  MoonIcon,
  PaletteIcon,
  ListTodoIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SunIcon,
  TerminalSquareIcon,
  UsersRoundIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  ApprovalDecision,
  ApprovalRequest,
  CodexEvent,
  CodexStatus,
  CodexThreadSummary,
} from "../../shared/codex";
import type { BackendState, RemoteAgentHostState } from "../../shared/backend";
import { formatErrorMessage } from "../../shared/error";
import { useCodexRuntime } from "./codex-runtime";
import { CodexAttachmentProvider } from "./codex-attachments";
import { TeamChat, type TeamView } from "./team-chat";
import { normalizeWorkspaceHistory, rememberWorkspace } from "./workspace-history";

const emptyStatus: CodexStatus = {
  connected: false,
  connecting: true,
  executable: null,
  version: null,
  error: null,
  account: null,
  requiresOpenaiAuth: false,
  models: [],
  defaultWorkspace: "",
};

const shortPath = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

type TimelineItem = {
  id: string;
  at: number;
  type: string;
  title: string;
  detail?: string;
};
type TimelineEvent = TimelineItem & { threadId?: string };

type ActiveCodexSession = {
  id: string | null;
  cwd: string;
  runtimeKey: string;
  initialMessages: ThreadMessageLike[];
};

const emptyCodexSession = (cwd: string): ActiveCodexSession => ({
  id: null,
  cwd,
  runtimeKey: `new:${cwd}:${Date.now()}`,
  initialMessages: [],
});

const timelineStorageKey = (threadId: string) => `codex.timeline:${threadId}`;

const readTimeline = (threadId: string) => {
  try {
    const value = JSON.parse(localStorage.getItem(timelineStorageKey(threadId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, index) => ({
        id: String(item.id ?? `legacy:${index}`),
        at: typeof item.at === "number" && Number.isFinite(item.at) ? item.at : Date.now(),
        type: typeof item.type === "string" ? item.type : "event",
        title: typeof item.title === "string" ? item.title : "运行事件",
        ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
      }))
      .slice(-200);
  } catch {
    return [];
  }
};

const historyText = (content: unknown) => {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const input = part as Record<string, unknown>;
      if (input.type === "text" && typeof input.text === "string") return input.text;
      if (
        input.type === "image" ||
        input.type === "localImage" ||
        input.type === "input_image" ||
        input.type === "local_image"
      )
        return "[图片附件]";
      if (input.type === "skill") return `[Skill: ${String(input.name ?? "unknown")}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const threadHistoryMessages = (turns: Array<Record<string, unknown>>): ThreadMessageLike[] => {
  const messages: ThreadMessageLike[] = [];
  for (const turn of turns) {
    const createdAt =
      typeof turn.startedAt === "number" ? new Date(turn.startedAt * 1000) : new Date();
    const items = Array.isArray(turn.items) ? turn.items : [];
    let reasoning = "";
    for (const value of items) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id : undefined;
      if (item.type === "userMessage") {
        const text = historyText(item.content);
        if (text) messages.push({ id, role: "user", content: text, createdAt });
      } else if (item.type === "reasoning") {
        reasoning = [item.summary, item.content]
          .filter(Array.isArray)
          .flatMap((entry) => entry as string[])
          .join("\n");
      } else if (item.type === "agentMessage" && typeof item.text === "string") {
        messages.push({
          id,
          role: "assistant",
          content: [
            ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
            { type: "text" as const, text: item.text },
          ],
          createdAt,
          status: { type: "complete", reason: "stop" },
        });
        reasoning = "";
      }
    }
  }
  return messages;
};

const CodexChatThread = ({
  workspace,
  model,
  threadId,
  initialMessages,
  onTimeline,
  onSlashCommand,
}: {
  workspace: string;
  model?: string;
  threadId?: string | null;
  initialMessages: readonly ThreadMessageLike[];
  onTimeline: (event: TimelineEvent) => void;
  onSlashCommand: (
    command: string,
    argument: string,
    threadId: string | null,
  ) => Promise<string | null>;
}) => {
  const runtime = useCodexRuntime({
    workspace,
    model,
    threadId,
    initialMessages,
    onTimelineEvent: onTimeline,
    onSlashCommand,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
};

const CodexChat = ({ workspace, model }: { workspace: string; model?: string }) => {
  const [sessions, setSessions] = useState<CodexThreadSummary[]>([]);
  const [selected, setSelected] = useState<ActiveCodexSession>(() => emptyCodexSession(workspace));
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandInfo, setCommandInfo] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [chatError, setChatError] = useState("");

  const refresh = useCallback(async () => {
    const next = await window.codex.listThreads({ cwd: workspace });
    setSessions(next);
  }, [workspace]);

  useEffect(() => {
    setSelected(emptyCodexSession(workspace));
    setTimeline([]);
    setChatError("");
    void refresh().catch(() => setSessions([]));
  }, [workspace, refresh]);

  const start = async (isolated = false) => {
    const execution = isolated
      ? await window.codex.createWorktree({
          cwd: workspace,
          key: `chat-${Date.now().toString(36)}`,
        })
      : { path: workspace };
    setSelected(emptyCodexSession(execution.path));
    setTimeline([]);
    setChatError("");
    setCommandOpen(false);
  };

  const reportChatError = (error: unknown) =>
    setChatError(error instanceof Error ? error.message : String(error));

  const select = async (thread: CodexThreadSummary) => {
    try {
      const detail = await window.codex.readThread({ threadId: thread.id });
      setSelected({
        id: thread.id,
        cwd: detail.cwd || thread.cwd || workspace,
        runtimeKey: `thread:${thread.id}:${Date.now()}`,
        initialMessages: threadHistoryMessages(detail.turns),
      });
      setTimeline(readTimeline(thread.id));
      setChatError("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    }
  };

  const archiveCurrent = async (threadId = selected.id) => {
    if (!threadId) throw new Error("当前还没有可归档的会话。");
    await window.codex.archiveThread({ threadId });
    if (selected.id === threadId) {
      setSelected(emptyCodexSession(workspace));
      setTimeline([]);
    }
    await refresh();
  };

  const deleteCurrent = async () => {
    if (!selected.id) return;
    await window.codex.deleteThread({ threadId: selected.id });
    localStorage.removeItem(timelineStorageKey(selected.id));
    setSelected(emptyCodexSession(workspace));
    setTimeline([]);
    setDeleteOpen(false);
    await refresh();
  };

  const renameCurrent = async () => {
    if (!selected.id || !renameValue.trim()) return;
    await window.codex.renameThread({ threadId: selected.id, name: renameValue.trim() });
    setRenameOpen(false);
    await refresh();
  };

  const forkCurrent = async () => {
    if (!selected.id) throw new Error("请先选择一个会话。");
    const forked = await window.codex.forkThread({ threadId: selected.id });
    const detail = await window.codex.resumeThread({ threadId: forked.threadId });
    setSelected({
      id: detail.id,
      cwd: detail.cwd || selected.cwd,
      runtimeKey: `thread:${detail.id}:${Date.now()}`,
      initialMessages: threadHistoryMessages(detail.turns),
    });
    setTimeline([]);
    await refresh();
  };

  const runCommand = async (command: string, argument = "", deferNavigation = false) => {
    setCommandInfo("");
    setChatError("");
    const navigate = (action: () => Promise<void>) => {
      setTimeout(() => void action().catch(reportChatError), 0);
    };
    try {
      if (command === "new") {
        if (deferNavigation) {
          navigate(() => start());
          return "正在创建新的本地会话。";
        }
        await start();
        return "已创建新的本地会话。";
      }
      if (command === "worktree") {
        if (deferNavigation) {
          navigate(() => start(true));
          return "正在创建隔离 Worktree 会话。";
        }
        await start(true);
        return "已创建隔离 Worktree 会话。";
      }
      if (command === "status") {
        return selected.id
          ? `当前会话：${selected.id}\n工作目录：${selected.cwd}\n时间线事件：${timeline.length}`
          : `尚未开始会话。\n工作目录：${selected.cwd}`;
      }
      if (command === "rename") {
        if (!selected.id) return "请先开始或选择一个会话。";
        if (!argument) {
          setRenameValue(sessions.find((thread) => thread.id === selected.id)?.name ?? "");
          setRenameOpen(true);
          return "请在重命名窗口中输入新名称。";
        }
        await window.codex.renameThread({ threadId: selected.id, name: argument });
        await refresh();
        return `会话已重命名为“${argument}”。`;
      }
      if (command === "archive") {
        if (deferNavigation) {
          navigate(() => archiveCurrent());
          return "正在归档当前会话。";
        }
        await archiveCurrent();
        return "会话已归档。";
      }
      if (command === "delete") {
        setDeleteOpen(true);
        return "请在确认窗口中删除会话。";
      }
      if (command === "fork") {
        if (deferNavigation) {
          navigate(() => forkCurrent());
          return "正在从当前上下文创建分支会话。";
        }
        await forkCurrent();
        return "已从当前上下文创建分支会话。";
      }
      if (command === "compact") {
        if (!selected.id) return "请先开始或选择一个会话。";
        await window.codex.compactThread({ threadId: selected.id });
        return "已请求 Codex 压缩当前会话上下文。";
      }
      if (command === "skills") {
        const skills = await window.codex.listSkills({ cwd: selected.cwd });
        return skills.length
          ? `当前可用 Skills：\n${skills.map((skill) => `- ${skill.name}${skill.enabled ? "" : "（已禁用）"}`).join("\n")}`
          : "当前目录没有可用 Skill。";
      }
      if (command === "mcp") {
        const servers = await window.codex.listMcpServers({
          threadId: selected.id ?? undefined,
        });
        return servers.length
          ? `MCP Servers：\n${servers.map((server) => `- ${String(server.name ?? "unknown")}：${String(server.runtimeStatus ?? server.authStatus ?? "configured")}`).join("\n")}`
          : "当前没有配置 MCP Server。";
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatError(message);
      return `命令执行失败：${message}`;
    }
  };

  const commands = [
    ["new", "新建本地会话"],
    ["worktree", "新建隔离会话"],
    ["status", "查看当前状态"],
    ["rename", "重命名会话"],
    ["fork", "创建分支会话"],
    ["compact", "压缩上下文"],
    ["skills", "查看可用 Skills"],
    ["mcp", "查看 MCP 状态"],
    ["archive", "归档当前会话"],
    ["delete", "删除当前会话"],
  ] as const;
  const visibleCommands = commands.filter(([command, label]) =>
    `${command} ${label}`.toLocaleLowerCase().includes(commandQuery.toLocaleLowerCase()),
  );

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-[224px_minmax(0,1fr)] overflow-hidden xl:grid-cols-[224px_minmax(0,1fr)_256px]">
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-secondary/35">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
              SESSIONS
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
              {sessions.length}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => void start().catch(reportChatError)}
            aria-label="新建会话"
          >
            <PlusIcon />
          </Button>
        </div>
        <div className="flex shrink-0 flex-col gap-1 border-b border-border/70 p-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void start().catch(reportChatError)}
            className="justify-start text-xs"
          >
            <PlusIcon data-icon="inline-start" /> 新建本地会话
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void start(true).catch(reportChatError)}
            className="justify-start text-xs"
          >
            <WorkflowIcon data-icon="inline-start" /> 新建隔离会话
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.map((thread) => (
            <div
              key={thread.id}
              className={`group mb-1 flex items-center gap-1 rounded-lg border transition-colors ${
                selected.id === thread.id
                  ? "border-border bg-card shadow-[var(--shadow-down-1)]"
                  : "border-transparent hover:bg-accent"
              }`}
            >
              <button
                type="button"
                onClick={() => void select(thread)}
                className="min-w-0 flex-1 px-2.5 py-2 text-left"
              >
                <div className="truncate text-xs font-medium text-foreground">{thread.name}</div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
                  <span className="truncate">{shortPath(thread.cwd || workspace)}</span>
                  {thread.cwd && thread.cwd !== workspace && (
                    <span className="shrink-0 rounded bg-muted px-1 py-px">worktree</span>
                  )}
                </div>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() =>
                  void archiveCurrent(thread.id).catch((error) => setChatError(String(error)))
                }
                className="mr-1 opacity-0 group-hover:opacity-100"
                aria-label="归档会话"
              >
                <ArchiveIcon />
              </Button>
            </div>
          ))}
          {!sessions.length && (
            <p className="px-2 py-5 text-center text-[11px] text-muted-foreground">还没有会话</p>
          )}
        </div>
      </aside>
      <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {selected.cwd}
          </div>
          <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCommandOpen((open) => !open)}
              className="text-xs"
            >
              <CommandIcon data-icon="inline-start" /> 命令
            </Button>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Codex 命令</DialogTitle>
                <DialogDescription>
                  可点击执行，也可以直接在消息框输入对应的斜杠命令。
                </DialogDescription>
              </DialogHeader>
              <Input
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="搜索命令…"
                autoFocus
              />
              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {visibleCommands.map(([command, label]) => (
                  <Button
                    key={command}
                    type="button"
                    variant={command === "delete" ? "destructive" : "ghost"}
                    onClick={() => {
                      void runCommand(command).then((message) => {
                        if (message) setCommandInfo(message);
                        if (!["status", "skills", "mcp"].includes(command)) setCommandOpen(false);
                      });
                    }}
                    className="justify-between"
                  >
                    <span>{label}</span>
                    <code className="text-[10px] opacity-70">/{command}</code>
                  </Button>
                ))}
              </div>
              {commandInfo && (
                <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-[11px] whitespace-pre-wrap">
                  {commandInfo}
                </pre>
              )}
            </DialogContent>
          </Dialog>
        </div>
        {chatError && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            {chatError}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <CodexAttachmentProvider key={selected.runtimeKey} cwd={selected.cwd}>
            <CodexChatThread
              key={selected.runtimeKey}
              workspace={selected.cwd}
              model={model}
              threadId={selected.id}
              initialMessages={selected.initialMessages}
              onSlashCommand={(command, argument) => runCommand(command, argument, true)}
              onTimeline={(event) => {
                if (event.threadId && !selected.id) {
                  setSelected((current) =>
                    current.id ? current : { ...current, id: event.threadId ?? null },
                  );
                  void refresh();
                }
                const threadId = event.threadId ?? selected.id;
                const { threadId: _threadId, ...timelineEvent } = event;
                setTimeline((current) => {
                  const existing = current.findIndex((item) => item.id === timelineEvent.id);
                  const nextTimeline =
                    existing < 0
                      ? [...current, timelineEvent].slice(-200)
                      : current.map((item, index) => (index === existing ? timelineEvent : item));
                  if (threadId) {
                    localStorage.setItem(
                      timelineStorageKey(threadId),
                      JSON.stringify(nextTimeline),
                    );
                  }
                  return nextTimeline;
                });
              }}
            />
          </CodexAttachmentProvider>
        </div>
      </section>
      <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-secondary/25 xl:flex">
        <div className="shrink-0 border-b border-border px-3 py-3">
          <div className="font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
            RUN TIMELINE
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">实时记录 Codex 工具与结果</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {timeline.map((event) => (
            <div key={event.id} className="border-l-2 border-primary/30 pl-2">
              <div className="text-[11px] font-medium text-foreground">{event.title}</div>
              <div className="font-mono text-[9px] text-muted-foreground">
                {new Date(event.at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              {event.detail && (
                <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                  {event.detail}
                </p>
              )}
            </div>
          ))}
          {!timeline.length && (
            <p className="text-[11px] text-muted-foreground">
              执行后将在这里显示思考摘要、命令、工具与完成状态。
            </p>
          )}
        </div>
      </aside>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>设置一个便于识别的会话名称。</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => void renameCurrent().catch(reportChatError)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>该操作会删除 Codex 会话记录，无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void deleteCurrent().catch(reportChatError)}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

type AppearanceTheme = "light" | "dark";

type AuthMode = "login" | "register";

const AuthenticationScreen = ({
  initialState,
  theme,
  onThemeChange,
  onAuthenticated,
}: {
  initialState: BackendState;
  theme: AppearanceTheme;
  onThemeChange: (theme: AppearanceTheme) => void;
  onAuthenticated: (state: BackendState) => void;
}) => {
  const [mode, setMode] = useState<AuthMode>("login");
  const [apiUrl, setApiUrl] = useState(initialState.apiUrl || "http://127.0.0.1:8790");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialState.error ?? "");

  const validHandle = /^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,31}$/.test(handle.trim());
  const canSubmit =
    Boolean(email.trim()) &&
    password.length >= 12 &&
    (mode === "login" || (validHandle && Boolean(displayName.trim())));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const state =
        mode === "login"
          ? await window.backend.login({
              apiUrl,
              email: email.trim(),
              password,
              deviceName: "Codex Desktop",
            })
          : await window.backend.register({
              apiUrl,
              email: email.trim(),
              password,
              handle: handle.trim(),
              displayName: displayName.trim(),
              deviceName: "Codex Desktop",
            });
      onAuthenticated(state);
    } catch (submitError) {
      setError(formatErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError("");
  };

  return (
    <div className={`app-shell theme-${theme} relative flex h-dvh min-h-[560px] overflow-hidden`}>
      <div className="pointer-events-none absolute -top-48 -left-32 size-128 rounded-full bg-primary/10 blur-3xl" />
      <div className="electron-drag absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-end px-5">
        <button
          type="button"
          aria-label={theme === "dark" ? "切换到白天模式" : "切换到黑夜模式"}
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
          className="electron-no-drag grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
        </button>
      </div>

      <Card className="relative z-10 m-auto grid w-[min(920px,calc(100vw-48px))] grid-cols-[1.05fr_0.95fr] overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-[var(--shadow-down-3)] max-[760px]:w-[min(460px,calc(100vw-32px))] max-[760px]:grid-cols-1">
        <div className="relative flex min-h-[590px] flex-col justify-between overflow-hidden border-r border-border bg-secondary/60 p-10 max-[760px]:hidden">
          <div className="pointer-events-none absolute -top-32 -left-24 size-80 rounded-full bg-primary/5 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-[var(--shadow-primary)]">
                CX
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">Codex Desktop</div>
                <div className="mt-0.5 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  Agent collaboration workspace
                </div>
              </div>
            </div>
            <h1 className="mt-20 max-w-sm text-3xl leading-[1.25] font-semibold tracking-tight text-foreground">
              和你的团队与 Agent，
              <br />
              在同一个空间工作。
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
              登录后访问好友、群聊、Agent 工作者和 Task。你的会话会安全地同步到聊天后台。
            </p>
          </div>
          <div className="relative flex items-center gap-2 text-[11px] text-muted-foreground">
            <KeyRoundIcon className="size-3.5 text-success" />
            账号认证已启用 · 登录状态安全保存在本机
          </div>
        </div>

        <div className="flex min-h-[590px] flex-col justify-center p-10 max-[520px]:p-6">
          <div className="mb-8 hidden items-center gap-3 max-[760px]:flex">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
              CX
            </div>
            <div className="text-sm font-semibold text-foreground">Codex Desktop</div>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {mode === "login" ? "欢迎回来" : "创建你的账号"}
            </h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {mode === "login"
                ? "登录后继续访问你的消息和 Agent 工作区。"
                : "只需填写账号资料，无需邮箱或短信验证。"}
            </p>
          </div>

          <Tabs
            value={mode}
            onValueChange={(val) => switchMode(val as AuthMode)}
            className="mt-7 w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" className="text-xs font-medium">
                登录
              </TabsTrigger>
              <TabsTrigger value="register" className="text-xs font-medium">
                注册
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
            {mode === "register" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">用户名</Label>
                  <Input
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    autoComplete="username"
                    placeholder="alice"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">昵称</Label>
                  <Input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    placeholder="Alice"
                    className="text-xs"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">邮箱</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">密码</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="至少 12 位"
                  className="pr-10 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-3.5" />
                  ) : (
                    <EyeIcon className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <Button type="submit" disabled={!canSubmit || busy} className="w-full font-medium">
              {busy && <LoaderCircleIcon className="size-3.5 animate-spin mr-2" />}
              {busy ? "正在连接…" : mode === "login" ? "登录并进入" : "注册并进入"}
            </Button>
          </form>

          {mode === "register" && handle && !validHandle && (
            <p className="mt-3 text-[11px] leading-5 text-warning ">
              用户名需为 3–32 位字母、数字、下划线或连字符。
            </p>
          )}
          {error && (
            <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[11px] leading-5 text-destructive">
              {error}
            </div>
          )}

          <Button
            type="button"
            variant="link"
            onClick={() => setShowServer((visible) => !visible)}
            className="mt-3 h-auto p-0 self-start text-xs text-muted-foreground hover:text-foreground"
          >
            {showServer ? "隐藏服务设置" : "服务设置"}
          </Button>
          {showServer && (
            <div className="mt-3 space-y-1.5">
              <Label className="text-xs text-muted-foreground">聊天后台地址</Label>
              <Input
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder="http://127.0.0.1:8790"
                className="font-mono text-xs"
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

const SettingsCenter = ({
  theme,
  workspace,
  onThemeChange,
  onClose,
}: {
  theme: AppearanceTheme;
  workspace: string;
  onThemeChange: (theme: AppearanceTheme) => void;
  onClose: () => void;
}) => {
  const [section, setSection] = useState<"appearance" | "account">("appearance");
  const [backend, setBackend] = useState<BackendState | null>(null);
  const [hostState, setHostState] = useState<RemoteAgentHostState | null>(null);
  const [apiUrl, setApiUrl] = useState("http://127.0.0.1:8790");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [backendBusy, setBackendBusy] = useState(false);
  const [backendError, setBackendError] = useState("");
  const [importResult, setImportResult] = useState("");

  useEffect(() => {
    let cancelled = false;
    void window.backend.getState().then(async (state) => {
      if (cancelled) return;
      setBackend(state);
      if (state.apiUrl) setApiUrl(state.apiUrl);
      if (!state.authenticated && state.hasRefreshToken) {
        try {
          await window.backend.request({ path: "/v1/me" });
          if (!cancelled) setBackend(await window.backend.getState());
        } catch {
          // The account panel exposes the sanitized reconnect error.
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void window.backend.getHostState().then(setHostState);
    return window.backend.onHostState(setHostState);
  }, []);

  const runBackendAction = async (action: () => Promise<BackendState>) => {
    setBackendBusy(true);
    setBackendError("");
    try {
      const state = await action();
      setBackend(state);
      if (state.authenticated && workspace) {
        await window.backend.startHost({ workspace }).catch((error) => {
          setBackendError(formatErrorMessage(error));
        });
      }
      setPassword("");
    } catch (error) {
      setBackendError(formatErrorMessage(error));
    } finally {
      setBackendBusy(false);
    }
  };

  const login = () =>
    runBackendAction(() =>
      window.backend.login({ apiUrl, email, password, deviceName: "Codex Desktop" }),
    );

  const register = () =>
    runBackendAction(() =>
      window.backend.register({
        apiUrl,
        email,
        password,
        handle,
        displayName,
        deviceName: "Codex Desktop",
      }),
    );

  const importWorkspace = async () => {
    if (!workspace) return;
    setBackendBusy(true);
    setBackendError("");
    setImportResult("");
    try {
      const result = await window.backend.importWorkspace({ workspace });
      setImportResult(
        `已导入 ${result.imported.agents} 个 Agent、${result.imported.rooms} 个会话、${result.imported.messages} 条消息和 ${result.imported.tasks} 个 Task。${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`,
      );
    } catch (error) {
      setBackendError(formatErrorMessage(error));
    } finally {
      setBackendBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[min(620px,calc(100vh-48px))] w-[min(820px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-[var(--shadow-down-3)]"
      >
        <aside className="w-48 shrink-0 border-r border-border bg-muted/40 p-4">
          <div className="px-2 pt-2 pb-5">
            <div id="settings-title" className="text-sm font-semibold text-foreground">
              设置中心
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">Codex Desktop</div>
          </div>
          {(
            [
              ["appearance", "外观", PaletteIcon],
              ["account", "账号与同步", CloudIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSection(value)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
                section === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="electron-drag flex h-16 items-center justify-between border-b border-border px-6">
            <div>
              <div className="text-sm font-medium text-foreground">
                {section === "appearance" ? "外观" : "账号与同步"}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {section === "appearance"
                  ? "选择你喜欢的界面主题"
                  : "连接聊天后台并同步好友、Agent、消息与 Task"}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="关闭设置中心"
              className="electron-no-drag text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </Button>
          </header>

          {section === "appearance" ? (
            <div className="p-6">
              <div className="text-xs font-medium text-foreground">主题模式</div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                设置会保存在当前电脑，下次启动自动恢复。
              </p>
              <div className="mt-5 grid grid-cols-2 gap-4">
                {(
                  [
                    {
                      value: "light",
                      label: "白天模式",
                      description: "明亮背景，适合日间环境",
                      Icon: SunIcon,
                    },
                    {
                      value: "dark",
                      label: "黑夜模式",
                      description: "低亮背景，适合夜间专注",
                      Icon: MoonIcon,
                    },
                  ] as const
                ).map(({ value, label, description, Icon }) => {
                  const selected = value === theme;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onThemeChange(value)}
                      aria-pressed={selected}
                      className={`overflow-hidden rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border bg-card hover:border-input0 hover:bg-muted/30"
                      }`}
                    >
                      <div
                        className={`relative h-32 overflow-hidden rounded-lg border ${
                          value === "light" ? "border-border bg-muted" : "border-border bg-muted"
                        }`}
                      >
                        <div
                          className={`absolute inset-y-0 left-0 w-12 border-r ${
                            value === "light" ? "border-border bg-muted" : "border-border bg-muted"
                          }`}
                        />
                        <div
                          className={`absolute top-4 right-4 left-16 h-3 rounded-full ${
                            value === "light" ? "bg-muted" : "bg-muted"
                          }`}
                        />
                        <div
                          className={`absolute top-12 right-9 left-16 h-12 rounded-lg border ${
                            value === "light" ? "border-border bg-muted" : "border-border bg-muted"
                          }`}
                        />
                        <div className="absolute right-5 bottom-4 h-2 w-20 rounded-full bg-primary/60" />
                      </div>
                      <div className="mt-3 flex items-center gap-3 px-1 pb-1">
                        <div
                          className={`grid size-8 place-items-center rounded-lg ${
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-foreground">{label}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {description}
                          </div>
                        </div>
                        <span
                          className={`size-3 rounded-full border-2 ${
                            selected ? "border-primary bg-primary" : "border-muted-foreground/30"
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-6">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium" htmlFor="backend-url">
                  聊天后台地址
                </Label>
                <Input
                  id="backend-url"
                  value={apiUrl}
                  onChange={(event) => setApiUrl(event.target.value)}
                  placeholder="https://chat.example.com"
                  className="text-xs"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  远程地址必须使用 HTTPS；本机开发可以使用 http://127.0.0.1。
                </p>
              </div>

              {backend?.authenticated && backend.user ? (
                <div className="rounded-xl border border-success/20 bg-success/5 p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-lg bg-success/10 text-sm font-medium text-success ">
                      {backend.user.displayName.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {backend.user.displayName}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        @{backend.user.handle} · {backend.user.email}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-success/30 bg-success/10 text-success "
                    >
                      已连接
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${hostState?.status === "connected" ? "bg-success" : hostState?.status === "connecting" ? "animate-pulse bg-warning" : "bg-muted-foreground"}`}
                    />
                    Agent Host：
                    {hostState?.status === "connected"
                      ? `${hostState.agentCount} 个 Agent 在线，${hostState.activeRunCount} 个任务运行中`
                      : hostState?.status === "connecting"
                        ? "正在连接"
                        : hostState?.error || "未启动"}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={backendBusy || !workspace}
                      onClick={() => void importWorkspace()}
                    >
                      同步当前项目
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={backendBusy}
                      onClick={() => void runBackendAction(() => window.backend.logout())}
                    >
                      退出后台账号
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">邮箱</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label className="text-xs">密码（至少 12 位）</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">新账号用户名</Label>
                    <Input
                      value={handle}
                      onChange={(event) => setHandle(event.target.value)}
                      placeholder="alice"
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">新账号昵称</Label>
                    <Input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Alice"
                      className="text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={backendBusy || !email || password.length < 12}
                    onClick={() => void login()}
                  >
                    登录
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      backendBusy || !email || password.length < 12 || !handle || !displayName
                    }
                    onClick={() => void register()}
                  >
                    注册
                  </Button>
                </div>
              )}

              {backendBusy && (
                <div className="flex items-center gap-2 text-[10px] text-info">
                  <LoaderCircleIcon className="size-3 animate-spin" /> 正在连接聊天后台…
                </div>
              )}
              {(backendError || backend?.error) && (
                <p className="rounded-xl border border-destructive/10 bg-destructive/5 p-3 text-[10px] leading-5 text-destructive/80">
                  {backendError || backend?.error}
                </p>
              )}
              {importResult && (
                <p className="rounded-xl border border-info/10 bg-info/5 p-3 text-[10px] leading-5 text-info/80">
                  {importResult}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

const ApprovalCard = ({
  approval,
  onResolve,
}: {
  approval: ApprovalRequest;
  onResolve: (decision: ApprovalDecision) => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const resolve = async (decision: ApprovalDecision) => {
    setBusy(true);
    try {
      await onResolve(decision);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="pointer-events-auto w-[min(32rem,calc(100vw-2rem))] border border-warning/30 bg-card p-4 shadow-[var(--shadow-down-3)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning ">
          {approval.command ? (
            <TerminalSquareIcon className="size-4" />
          ) : (
            <ShieldCheckIcon className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{approval.title}</div>
          {approval.reason && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{approval.reason}</p>
          )}
          {approval.command && (
            <pre className="mt-3 max-h-32 overflow-auto rounded-xl border border-border bg-muted/60 p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
              {approval.command}
            </pre>
          )}
          {approval.cwd && (
            <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
              {approval.cwd}
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void resolve("decline")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              拒绝
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void resolve("accept")}
              className="text-xs"
            >
              仅允许本次
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void resolve("acceptForSession")}
              className="bg-warning text-xs font-medium text-warning-foreground hover:bg-warning/85"
            >
              本会话允许
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

const AuthenticatedApp = () => {
  const [status, setStatus] = useState<CodexStatus>(emptyStatus);
  const [workspace, setWorkspace] = useState(() => localStorage.getItem("codex.workspace") ?? "");
  const [projects, setProjects] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("codex.projects") ?? "[]");
      return normalizeWorkspaceHistory(localStorage.getItem("codex.workspace") ?? "", stored);
    } catch {
      return normalizeWorkspaceHistory(localStorage.getItem("codex.workspace") ?? "", []);
    }
  });
  const [workspaceValid, setWorkspaceValid] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<AppearanceTheme>(() =>
    localStorage.getItem("codex.theme") === "dark" ? "dark" : "light",
  );
  const [mode, setMode] = useState<TeamView | "solo">(() => {
    const saved = localStorage.getItem("codex.chat-mode");
    return saved === "solo" || saved === "contacts" || saved === "tasks" ? saved : "messages";
  });

  const changeMode = (next: TeamView | "solo") => {
    setMode(next);
    localStorage.setItem("codex.chat-mode", next);
  };

  const rememberProject = (path: string) => {
    localStorage.setItem("codex.workspace", path);
    setProjects((current) => {
      const next = rememberWorkspace(current, path);
      localStorage.setItem("codex.projects", JSON.stringify(next));
      return next;
    });
    if (path === workspace) return;
    setWorkspaceValid(false);
    setWorkspaceError("");
    setWorkspace(path);
    setApprovals([]);
  };

  const changeTheme = (next: AppearanceTheme) => {
    setTheme(next);
    localStorage.setItem("codex.theme", next);
    void (async () => {
      const backend = await window.backend.getState();
      if (!backend.authenticated) return;
      const settings = await window.backend.request<{
        revision: number;
        values: Record<string, unknown>;
      }>({ path: "/v1/settings" });
      await window.backend.request({
        method: "PUT",
        path: "/v1/settings",
        headers: { "if-match": String(settings.revision) },
        body: { ...settings.values, theme: next },
      });
    })().catch(() => undefined);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!workspace) {
      setWorkspaceValid(false);
      setWorkspaceError("");
      return;
    }

    let cancelled = false;
    setWorkspaceValid(false);
    setWorkspaceError("");
    void window.codex
      .validateWorkspace({ cwd: workspace })
      .then((result) => {
        if (cancelled) return;
        setWorkspaceValid(result.valid);
        setWorkspaceError(result.valid ? "" : result.error || "这个 Workspace 无法访问。");
      })
      .catch((error) => {
        if (cancelled) return;
        setWorkspaceValid(false);
        setWorkspaceError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const connect = useCallback(async () => {
    setStatus((current) => ({ ...current, connecting: true, error: null }));
    try {
      const next = await window.codex.connect();
      setStatus(next);
      setWorkspace((current) => {
        if (current || !next.defaultWorkspace) return current;
        localStorage.setItem("codex.workspace", next.defaultWorkspace);
        setProjects((projects) => {
          const updated = rememberWorkspace(projects, next.defaultWorkspace);
          localStorage.setItem("codex.projects", JSON.stringify(updated));
          return updated;
        });
        return next.defaultWorkspace;
      });
      setSelectedModel(
        (current) =>
          current ||
          next.models.find((model) => model.isDefault)?.model ||
          next.models[0]?.model ||
          "",
      );
    } catch (error) {
      setStatus((current) => ({
        ...current,
        connected: false,
        connecting: false,
        error: formatErrorMessage(error),
      }));
    }
  }, []);

  useEffect(() => {
    void connect();
    return window.codex.onEvent((event: CodexEvent) => {
      if (event.method === "desktop/status/changed") {
        setStatus(event.params as unknown as CodexStatus);
      } else if (event.method === "desktop/approval/requested") {
        const approval = event.params as unknown as ApprovalRequest;
        setApprovals((current) => [
          ...current.filter((item) => item.requestId !== approval.requestId),
          approval,
        ]);
      } else if (event.method === "serverRequest/resolved") {
        const requestId = event.params.requestId;
        setApprovals((current) => current.filter((item) => item.requestId !== requestId));
      }
    });
  }, [connect]);

  useEffect(() => {
    if (!workspace || !workspaceValid) return;
    void (async () => {
      const backend = await window.backend.getState();
      if (!backend.authenticated && backend.hasRefreshToken) {
        await window.backend.request({ path: "/v1/me" });
      }
      const current = await window.backend.getState();
      if (current.authenticated) {
        const settings = await window.backend
          .request<{ values: Record<string, unknown> }>({ path: "/v1/settings" })
          .catch(() => null);
        if (settings?.values.theme === "light" || settings?.values.theme === "dark") {
          const cloudTheme = settings.values.theme;
          setTheme(cloudTheme);
          localStorage.setItem("codex.theme", cloudTheme);
        }
        await window.backend.startHost({ workspace });
      }
    })().catch(() => undefined);
  }, [workspace, workspaceValid]);

  const chooseWorkspace = async () => {
    const selected = await window.codex.chooseWorkspace();
    if (!selected) return;
    rememberProject(selected);
  };

  const resolveApproval = async (approval: ApprovalRequest, decision: ApprovalDecision) => {
    await window.codex.resolveApproval({ requestId: approval.requestId, decision });
    setApprovals((current) => current.filter((item) => item.requestId !== approval.requestId));
  };

  const needsLogin = status.connected && status.requiresOpenaiAuth && !status.account;
  const ready = status.connected && !needsLogin && Boolean(workspace) && workspaceValid;
  const accountLabel =
    status.account?.type === "chatgpt"
      ? status.account.email || "ChatGPT"
      : status.account?.type === "apiKey"
        ? "API Key"
        : status.account
          ? "已登录"
          : "使用本机配置";
  const activeModel = selectedModel || status.models.find((model) => model.isDefault)?.model || "";
  const runtimeKey = `${workspace}:${status.connected}`;
  const currentApproval = approvals[0];

  return (
    <div className={`app-shell theme-${theme} flex h-dvh min-h-0 overflow-hidden`}>
      <aside className="app-sidebar relative flex w-[240px] shrink-0 flex-col border-r border-border font-sans">
        <div className="app-titlebar electron-drag flex h-12 shrink-0 items-center justify-between border-b border-border px-3 pl-[76px]">
          <div className="flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded bg-foreground text-[10px] font-mono font-bold text-background">
              CX
            </span>
            <span className="text-xs font-semibold tracking-tight text-foreground">Codex</span>
          </div>
          <span className="rounded border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            v0.1
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2.5">
          <section>
            <div className="mb-1.5 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
              Views
            </div>
            <div className="space-y-0.5">
              {(
                [
                  ["messages", "消息流", UsersRoundIcon],
                  ["tasks", "Task 看板", ListTodoIcon],
                  ["contacts", "通讯录与 Agent", BookUserIcon],
                ] as const
              ).map(([value, label, Icon]) => {
                const isActive = mode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeMode(value)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium transition ${
                      isActive
                        ? "bg-card text-foreground shadow-[var(--shadow-down-1)]"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="flex-1">{label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => changeMode("solo")}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium transition ${
                  mode === "solo"
                    ? "bg-card text-foreground shadow-[var(--shadow-down-1)]"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <MessageSquareIcon className="size-3.5 shrink-0" />
                <span className="flex-1">Codex 私聊</span>
              </button>
            </div>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between px-2">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
                Workspaces
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => void chooseWorkspace()}
                aria-label="添加 Workspace"
                title="打开文件夹"
              >
                <PlusIcon />
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              {projects.length > 0 ? (
                projects.map((project) => {
                  const active = project === workspace;
                  return (
                    <Button
                      key={project}
                      type="button"
                      variant="ghost"
                      onClick={() => rememberProject(project)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "h-auto min-w-0 justify-start gap-2.5 whitespace-normal px-2 py-2 text-left",
                        active && "border-border bg-card shadow-[var(--shadow-down-1)]",
                      )}
                    >
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {shortPath(project)}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[9px] font-normal text-muted-foreground">
                          {project}
                        </span>
                      </span>
                    </Button>
                  );
                })
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => void chooseWorkspace()}
                >
                  <FolderIcon data-icon="inline-start" />
                  打开文件夹
                </Button>
              )}
            </div>
            {workspaceError && (
              <p className="mt-1.5 px-2 text-[10px] leading-4 text-destructive">{workspaceError}</p>
            )}
          </section>

          <section>
            <div className="mb-1.5 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
              Model
            </div>
            {status.models.length > 0 ? (
              <Select value={activeModel} onValueChange={(val) => setSelectedModel(val ?? "")}>
                <SelectTrigger className="h-8 w-full rounded text-xs font-mono">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {status.models.map((model) => (
                      <SelectItem key={model.id} value={model.model} className="text-xs font-mono">
                        {model.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded border border-border bg-background/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                Codex Default
              </div>
            )}
          </section>

          <section className="mt-auto rounded-lg border border-border bg-card p-2.5 shadow-[var(--shadow-down-1)]">
            <div className="flex items-center gap-2">
              <span
                className={`size-2 rounded-full ${
                  status.connecting
                    ? "animate-pulse bg-warning"
                    : status.connected
                      ? "bg-success "
                      : "bg-destructive"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {status.connecting
                    ? "Connecting Codex..."
                    : status.connected
                      ? "Engine Connected"
                      : "Connection Failed"}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {status.connected ? accountLabel : (status.error ?? "Offline")}
                </div>
              </div>
              {!status.connected && !status.connecting && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void connect()}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  aria-label="重试连接"
                >
                  <RefreshCwIcon className="size-3" />
                </Button>
              )}
            </div>
            {needsLogin && (
              <Button
                type="button"
                size="sm"
                onClick={() => void window.codex.login()}
                className="mt-2 h-7 w-full gap-1.5 rounded text-xs font-medium"
              >
                <LogInIcon className="size-3" />
                登录 ChatGPT
              </Button>
            )}
          </section>
        </div>
        <div className="shrink-0 border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="flex h-8 w-full items-center justify-between rounded px-2 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <Settings2Icon className="size-3.5" />
              设置中心
            </span>
            <span className="font-mono text-[10px]">{theme === "dark" ? "Dark" : "Light"}</span>
          </Button>
        </div>
      </aside>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {mode === "solo" && (
          <header className="app-titlebar electron-drag relative z-10 flex h-12 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2 font-mono text-xs text-foreground">
              <BotIcon className="size-3.5 text-muted-foreground" />
              <span className="font-semibold">codex</span>
              {workspace && <span className="text-muted-foreground/40">/</span>}
              {workspace && (
                <span className="max-w-72 truncate text-muted-foreground">
                  {shortPath(workspace)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                workspace:rw · prompt-confirm
              </span>
            </div>
          </header>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {ready ? (
            mode !== "solo" ? (
              <TeamChat
                key={`${workspace}:team`}
                workspace={workspace}
                model={activeModel || undefined}
                view={mode}
                onViewChange={changeMode}
              />
            ) : (
              <CodexChat key={runtimeKey} workspace={workspace} model={activeModel || undefined} />
            )
          ) : (
            <div className="grid h-full place-items-center px-8 text-center">
              <div className="max-w-sm">
                {status.connecting ? (
                  <LoaderCircleIcon className="mx-auto size-7 animate-spin text-primary" />
                ) : (
                  <CircleAlertIcon className="mx-auto size-7 text-muted-foreground" />
                )}
                <h2 className="mt-4 text-base font-medium text-foreground">
                  {status.connecting
                    ? "正在启动本机 Codex…"
                    : needsLogin
                      ? "需要登录 Codex"
                      : !workspace
                        ? "请选择项目目录"
                        : workspaceError
                          ? "无法打开 Workspace"
                          : "Codex 暂不可用"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {workspaceError ||
                    status.error ||
                    "连接完成后，就可以让 Codex 读取、修改并运行这个项目。"}
                </p>
              </div>
            </div>
          )}
        </div>

        {currentApproval && (
          <div className="pointer-events-none absolute inset-x-0 top-20 z-50 flex justify-center px-4">
            <ApprovalCard
              approval={currentApproval}
              onResolve={(decision) => resolveApproval(currentApproval, decision)}
            />
          </div>
        )}
      </main>
      {settingsOpen && (
        <SettingsCenter
          theme={theme}
          workspace={workspace}
          onThemeChange={changeTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export const App = () => {
  const [backend, setBackend] = useState<BackendState | null>(null);
  const [theme, setTheme] = useState<AppearanceTheme>(() =>
    localStorage.getItem("codex.theme") === "dark" ? "dark" : "light",
  );

  const changeTheme = (next: AppearanceTheme) => {
    setTheme(next);
    localStorage.setItem("codex.theme", next);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let active = true;
    const loadAuthentication = async () => {
      let state = await window.backend.getState();
      if (!state.authenticated && state.hasRefreshToken) {
        await window.backend.request({ path: "/v1/me" }).catch(() => undefined);
        state = await window.backend.getState();
      }
      if (active) setBackend(state);
    };
    void loadAuthentication();
    const unsubscribe = window.backend.onEvent((event) => {
      if (event.type !== "auth.changed") return;
      void window.backend.getState().then((state) => {
        if (!active) return;
        setBackend(state);
        if (!state.authenticated) {
          setTheme(localStorage.getItem("codex.theme") === "light" ? "light" : "dark");
        }
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!backend) {
    return (
      <div
        className={`app-shell theme-${theme} electron-drag grid h-dvh place-items-center text-center`}
      >
        <div>
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-[var(--shadow-primary)]">
            CX
          </div>
          <LoaderCircleIcon className="mx-auto mt-5 size-4 animate-spin text-info" />
          <p className="mt-3 text-xs text-foreground">正在验证登录状态…</p>
        </div>
      </div>
    );
  }

  if (!backend.authenticated) {
    return (
      <AuthenticationScreen
        initialState={backend}
        theme={theme}
        onThemeChange={changeTheme}
        onAuthenticated={setBackend}
      />
    );
  }

  return <AuthenticatedApp />;
};
