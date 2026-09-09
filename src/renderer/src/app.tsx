import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  BookUserIcon,
  BotIcon,
  CircleAlertIcon,
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
  RefreshCwIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SunIcon,
  TerminalSquareIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import type {
  ApprovalDecision,
  ApprovalRequest,
  CodexEvent,
  CodexStatus,
} from "../../shared/codex";
import type { BackendState, RemoteAgentHostState } from "../../shared/backend";
import { useCodexRuntime } from "./codex-runtime";
import { TeamChat, type TeamView } from "./team-chat";

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

const CodexChat = ({ workspace, model }: { workspace: string; model?: string }) => {
  const runtime = useCodexRuntime({ workspace, model });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
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
      setError(submitError instanceof Error ? submitError.message : String(submitError));
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
          setBackendError(error instanceof Error ? error.message : String(error));
        });
      }
      setPassword("");
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : String(error));
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
      setBackendError(error instanceof Error ? error.message : String(error));
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

  const connect = useCallback(async () => {
    setStatus((current) => ({ ...current, connecting: true, error: null }));
    try {
      const next = await window.codex.connect();
      setStatus(next);
      setWorkspace((current) => {
        if (current || !next.defaultWorkspace) return current;
        localStorage.setItem("codex.workspace", next.defaultWorkspace);
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
        error: error instanceof Error ? error.message : String(error),
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
    if (!workspace) return;
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
  }, [workspace]);

  const chooseWorkspace = async () => {
    const selected = await window.codex.chooseWorkspace();
    if (!selected) return;
    localStorage.setItem("codex.workspace", selected);
    setWorkspace(selected);
    setApprovals([]);
  };

  const resolveApproval = async (approval: ApprovalRequest, decision: ApprovalDecision) => {
    await window.codex.resolveApproval({ requestId: approval.requestId, decision });
    setApprovals((current) => current.filter((item) => item.requestId !== approval.requestId));
  };

  const needsLogin = status.connected && status.requiresOpenaiAuth && !status.account;
  const ready = status.connected && !needsLogin && Boolean(workspace);
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
            <div className="mb-1.5 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
              Workspace
            </div>
            <button
              type="button"
              onClick={() => void chooseWorkspace()}
              className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card p-2 text-left transition hover:border-primary/40 hover:bg-accent"
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {workspace ? shortPath(workspace) : "选择工作区目录"}
                </div>
                <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                  {workspace || "尚未指定目录"}
                </div>
              </div>
            </button>
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

      <main className="relative min-w-0 flex-1 bg-background">
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

        <div className={`relative ${mode !== "solo" ? "h-full" : "h-[calc(100%-4rem)]"}`}>
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
                        : "Codex 暂不可用"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {status.error || "连接完成后，就可以让 Codex 读取、修改并运行这个项目。"}
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
