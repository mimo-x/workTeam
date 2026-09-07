import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  BookUserIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(45,212,191,0.16),transparent_34%),radial-gradient(circle_at_85%_80%,rgba(6,182,212,0.1),transparent_30%)]" />
      <div className="electron-drag absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-end px-5">
        <button
          type="button"
          aria-label={theme === "dark" ? "切换到白天模式" : "切换到黑夜模式"}
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
          className="electron-no-drag grid size-9 place-items-center rounded-xl border border-white/8 bg-white/4 text-zinc-500 transition hover:bg-white/8 hover:text-zinc-200"
        >
          {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
        </button>
      </div>

      <section className="relative z-10 m-auto grid w-[min(920px,calc(100vw-48px))] grid-cols-[1.05fr_0.95fr] overflow-hidden rounded-[28px] border border-white/8 bg-[#0b0e15]/95 shadow-2xl shadow-black/30 max-[760px]:w-[min(460px,calc(100vw-32px))] max-[760px]:grid-cols-1">
        <div className="relative flex min-h-[590px] flex-col justify-between overflow-hidden border-r border-white/7 p-10 max-[760px]:hidden">
          <div className="pointer-events-none absolute -top-32 -left-24 size-80 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-bold text-slate-950 shadow-[0_12px_40px_rgba(45,212,191,0.22)]">
                CX
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-100">Codex Desktop</div>
                <div className="mt-0.5 text-[10px] tracking-[0.18em] text-zinc-600 uppercase">
                  Agent collaboration workspace
                </div>
              </div>
            </div>
            <h1 className="mt-20 max-w-sm text-3xl leading-[1.25] font-semibold tracking-tight text-zinc-100">
              和你的团队与 Agent，
              <br />
              在同一个空间工作。
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-zinc-500">
              登录后访问好友、群聊、Agent 工作者和 Task。你的会话会安全地同步到聊天后台。
            </p>
          </div>
          <div className="relative flex items-center gap-2 text-[10px] text-zinc-600">
            <KeyRoundIcon className="size-3.5 text-emerald-400/70" />
            账号认证已启用 · 登录状态安全保存在本机
          </div>
        </div>

        <div className="flex min-h-[590px] flex-col justify-center p-10 max-[520px]:p-6">
          <div className="mb-8 hidden items-center gap-3 max-[760px]:flex">
            <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-bold text-slate-950">
              CX
            </div>
            <div className="text-sm font-semibold text-zinc-100">Codex Desktop</div>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
              {mode === "login" ? "欢迎回来" : "创建你的账号"}
            </h2>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {mode === "login"
                ? "登录后继续访问你的消息和 Agent 工作区。"
                : "只需填写账号资料，无需邮箱或短信验证。"}
            </p>
          </div>

          <div className="mt-7 grid grid-cols-2 rounded-xl bg-white/4 p-1">
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => switchMode(value)}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${mode === value ? "bg-white/9 text-zinc-100 shadow-sm" : "text-zinc-600 hover:text-zinc-300"}`}
              >
                {value === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
            {mode === "register" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[10px] text-zinc-500">
                  用户名
                  <input
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    autoComplete="username"
                    placeholder="alice"
                    className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-cyan-300/35"
                  />
                </label>
                <label className="text-[10px] text-zinc-500">
                  昵称
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    placeholder="Alice"
                    className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-cyan-300/35"
                  />
                </label>
              </div>
            )}
            <label className="block text-[10px] text-zinc-500">
              邮箱
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
                className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-cyan-300/35"
              />
            </label>
            <label className="block text-[10px] text-zinc-500">
              密码
              <span className="relative mt-1.5 block">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={12}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="至少 12 位"
                  className="w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 pr-10 text-xs text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-cyan-300/35"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-600 hover:text-zinc-300"
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-3.5" />
                  ) : (
                    <EyeIcon className="size-3.5" />
                  )}
                </button>
              </span>
            </label>

            <button
              type="submit"
              disabled={!canSubmit || busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-xs font-semibold text-cyan-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && <LoaderCircleIcon className="size-3.5 animate-spin" />}
              {busy ? "正在连接…" : mode === "login" ? "登录并进入" : "注册并进入"}
            </button>
          </form>

          {mode === "register" && handle && !validHandle && (
            <p className="mt-3 text-[10px] leading-5 text-amber-300/80">
              用户名需为 3–32 位字母、数字、下划线或连字符。
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-xl border border-red-300/10 bg-red-300/5 p-3 text-[10px] leading-5 text-red-300/80">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowServer((visible) => !visible)}
            className="mt-5 self-start text-[10px] text-zinc-600 hover:text-zinc-400"
          >
            {showServer ? "隐藏服务设置" : "服务设置"}
          </button>
          {showServer && (
            <label className="mt-3 block text-[10px] text-zinc-500">
              聊天后台地址
              <input
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder="http://127.0.0.1:8790"
                className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 font-mono text-[10px] text-zinc-300 outline-none focus:border-cyan-300/35"
              />
            </label>
          )}
        </div>
      </section>
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
      className="settings-backdrop fixed inset-0 z-[100] grid place-items-center bg-black/70 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="settings-dialog flex h-[min(620px,calc(100vh-48px))] w-[min(820px,calc(100vw-48px))] overflow-hidden rounded-3xl border border-white/10 bg-[#0b0e15] shadow-2xl shadow-black/30"
      >
        <aside className="settings-nav w-48 shrink-0 border-r border-white/7 bg-black/15 p-4">
          <div className="px-2 pt-2 pb-5">
            <div id="settings-title" className="text-sm font-semibold text-zinc-100">
              设置中心
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">Codex Desktop</div>
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
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs ${section === value ? "bg-cyan-300/8 text-cyan-200" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"}`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <header className="electron-drag flex h-16 items-center justify-between border-b border-white/7 px-6">
            <div>
              <div className="text-sm font-medium text-zinc-200">
                {section === "appearance" ? "外观" : "账号与同步"}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-600">
                {section === "appearance"
                  ? "选择你喜欢的界面主题"
                  : "连接聊天后台并同步好友、Agent、消息与 Task"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭设置中心"
              className="electron-no-drag grid size-8 place-items-center rounded-xl text-zinc-500 hover:bg-white/6 hover:text-zinc-200"
            >
              <XIcon className="size-4" />
            </button>
          </header>

          {section === "appearance" ? (
            <div className="p-6">
              <div className="text-xs font-medium text-zinc-300">主题模式</div>
              <p className="mt-1 text-[11px] leading-5 text-zinc-600">
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
                      className={`overflow-hidden rounded-2xl border p-3 text-left transition ${selected ? "border-cyan-300/35 bg-cyan-300/7" : "border-white/8 bg-white/[0.025] hover:border-white/15"}`}
                    >
                      <div
                        className={`relative h-32 overflow-hidden rounded-xl border ${value === "light" ? "border-slate-200 bg-slate-100" : "theme-preview-dark border-white/8 bg-[#080b12]"}`}
                      >
                        <div
                          className={`absolute inset-y-0 left-0 w-12 border-r ${value === "light" ? "border-slate-200 bg-white" : "border-white/7 bg-[#0b0e15]"}`}
                        />
                        <div
                          className={`absolute top-4 right-4 left-16 h-3 rounded-full ${value === "light" ? "bg-white" : "bg-white/7"}`}
                        />
                        <div
                          className={`absolute top-12 right-9 left-16 h-12 rounded-lg border ${value === "light" ? "border-slate-200 bg-white" : "border-white/7 bg-white/3"}`}
                        />
                        <div className="absolute right-5 bottom-4 h-2 w-20 rounded-full bg-cyan-400/60" />
                      </div>
                      <div className="mt-3 flex items-center gap-3 px-1 pb-1">
                        <div
                          className={`grid size-8 place-items-center rounded-xl ${selected ? "bg-cyan-300/12 text-cyan-300" : "bg-white/5 text-zinc-500"}`}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-zinc-200">{label}</div>
                          <div className="mt-0.5 text-[10px] text-zinc-600">{description}</div>
                        </div>
                        <span
                          className={`size-3 rounded-full border-2 ${selected ? "border-cyan-300 bg-cyan-300 shadow-[inset_0_0_0_2px_var(--theme-radio-inner)]" : "border-white/15"}`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-5 p-6">
              <div>
                <label className="text-xs font-medium text-zinc-300" htmlFor="backend-url">
                  聊天后台地址
                </label>
                <input
                  id="backend-url"
                  value={apiUrl}
                  onChange={(event) => setApiUrl(event.target.value)}
                  placeholder="https://chat.example.com"
                  className="mt-2 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-cyan-300/30"
                />
                <p className="mt-1.5 text-[10px] text-zinc-600">
                  远程地址必须使用 HTTPS；本机开发可以使用 http://127.0.0.1。
                </p>
              </div>

              {backend?.authenticated && backend.user ? (
                <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl bg-emerald-300/10 text-sm text-emerald-200">
                      {backend.user.displayName.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-200">
                        {backend.user.displayName}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-zinc-600">
                        @{backend.user.handle} · {backend.user.email}
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[9px] text-emerald-300">
                      已连接
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[9px] text-zinc-500">
                    <span
                      className={`size-1.5 rounded-full ${hostState?.status === "connected" ? "bg-emerald-300" : hostState?.status === "connecting" ? "animate-pulse bg-amber-300" : "bg-zinc-600"}`}
                    />
                    Agent Host：
                    {hostState?.status === "connected"
                      ? `${hostState.agentCount} 个 Agent 在线，${hostState.activeRunCount} 个任务运行中`
                      : hostState?.status === "connecting"
                        ? "正在连接"
                        : hostState?.error || "未启动"}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      disabled={backendBusy || !workspace}
                      onClick={() => void importWorkspace()}
                      className="rounded-lg bg-cyan-300 px-3 py-2 text-[10px] font-medium text-cyan-950 disabled:opacity-40"
                    >
                      同步当前项目
                    </button>
                    <button
                      type="button"
                      disabled={backendBusy}
                      onClick={() => void runBackendAction(() => window.backend.logout())}
                      className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-zinc-400 hover:text-white disabled:opacity-40"
                    >
                      退出后台账号
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="col-span-2 text-[10px] text-zinc-500">
                    邮箱
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-cyan-300/30"
                    />
                  </label>
                  <label className="col-span-2 text-[10px] text-zinc-500">
                    密码（至少 12 位）
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-cyan-300/30"
                    />
                  </label>
                  <label className="text-[10px] text-zinc-500">
                    新账号用户名
                    <input
                      value={handle}
                      onChange={(event) => setHandle(event.target.value)}
                      placeholder="alice"
                      className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-cyan-300/30"
                    />
                  </label>
                  <label className="text-[10px] text-zinc-500">
                    新账号昵称
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="Alice"
                      className="mt-1.5 w-full rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-cyan-300/30"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={backendBusy || !email || password.length < 12}
                    onClick={() => void login()}
                    className="rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-medium text-cyan-950 disabled:opacity-40"
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    disabled={
                      backendBusy || !email || password.length < 12 || !handle || !displayName
                    }
                    onClick={() => void register()}
                    className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
                  >
                    注册
                  </button>
                </div>
              )}

              {backendBusy && (
                <div className="flex items-center gap-2 text-[10px] text-cyan-300">
                  <LoaderCircleIcon className="size-3 animate-spin" /> 正在连接聊天后台…
                </div>
              )}
              {(backendError || backend?.error) && (
                <p className="rounded-xl border border-red-300/10 bg-red-300/5 p-3 text-[10px] leading-5 text-red-300/80">
                  {backendError || backend?.error}
                </p>
              )}
              {importResult && (
                <p className="rounded-xl border border-cyan-300/10 bg-cyan-300/5 p-3 text-[10px] leading-5 text-cyan-200/80">
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
    <div className="pointer-events-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-amber-300/20 bg-[#17130d]/96 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
          {approval.command ? (
            <TerminalSquareIcon className="size-4" />
          ) : (
            <ShieldCheckIcon className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100">{approval.title}</div>
          {approval.reason && (
            <p className="mt-1 text-xs leading-5 text-zinc-400">{approval.reason}</p>
          )}
          {approval.command && (
            <pre className="mt-3 max-h-32 overflow-auto rounded-xl border border-white/8 bg-black/35 p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-zinc-300">
              {approval.command}
            </pre>
          )}
          {approval.cwd && (
            <div className="mt-2 truncate font-mono text-[10px] text-zinc-600">{approval.cwd}</div>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve("decline")}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/6 hover:text-white disabled:opacity-50"
            >
              拒绝
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve("accept")}
              className="rounded-lg border border-white/10 bg-white/7 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/12 disabled:opacity-50"
            >
              仅允许本次
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve("acceptForSession")}
              className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-medium text-amber-950 transition hover:bg-amber-200 disabled:opacity-50"
            >
              本会话允许
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AuthenticatedApp = () => {
  const [status, setStatus] = useState<CodexStatus>(emptyStatus);
  const [workspace, setWorkspace] = useState(() => localStorage.getItem("codex.workspace") ?? "");
  const [selectedModel, setSelectedModel] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<AppearanceTheme>(() =>
    localStorage.getItem("codex.theme") === "light" ? "light" : "dark",
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
      <aside className="app-sidebar relative flex w-[286px] shrink-0 flex-col border-r border-white/7">
        <div className="electron-drag flex h-16 shrink-0 items-center gap-3 border-b border-white/7 px-5 pl-[78px]">
          <div className="electron-no-drag grid size-8 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-xs font-bold text-slate-950 shadow-[0_8px_30px_rgba(45,212,191,0.16)]">
            CX
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">Codex Desktop</div>
            <div className="text-[10px] tracking-[0.18em] text-zinc-600 uppercase">
              local app server
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section>
            <div className="mb-2 px-1 text-[10px] font-medium tracking-[0.16em] text-zinc-600 uppercase">
              对话
            </div>
            <div className="space-y-1">
              {(
                [
                  ["messages", "消息", UsersRoundIcon],
                  ["contacts", "通讯录", BookUserIcon],
                  ["tasks", "Task 面板", ListTodoIcon],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeMode(value)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition ${
                    mode === value
                      ? "bg-cyan-300/8 text-cyan-100"
                      : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300"
                  }`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => changeMode("solo")}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition ${
                  mode === "solo"
                    ? "bg-white/7 text-zinc-200"
                    : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300"
                }`}
              >
                <MessageSquareIcon className="size-4" />
                Codex 私聊
              </button>
            </div>
          </section>

          <section>
            <div className="mb-2 px-1 text-[10px] font-medium tracking-[0.16em] text-zinc-600 uppercase">
              项目
            </div>
            <button
              type="button"
              onClick={() => void chooseWorkspace()}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/3 p-3 text-left transition hover:border-white/15 hover:bg-white/5"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-400/8 text-cyan-300">
                <FolderIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-200">
                  {workspace ? shortPath(workspace) : "选择项目目录"}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
                  {workspace || "Codex 将在此目录中工作"}
                </div>
              </div>
            </button>
          </section>

          <section>
            <div className="mb-2 px-1 text-[10px] font-medium tracking-[0.16em] text-zinc-600 uppercase">
              模型
            </div>
            <div className="relative">
              <select
                value={activeModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={!status.models.length}
                className="w-full appearance-none rounded-xl border border-white/8 bg-white/3 px-3 py-2.5 pr-8 text-xs text-zinc-300 outline-none transition focus:border-cyan-400/30 disabled:opacity-50"
              >
                {!status.models.length && <option value="">使用 Codex 默认模型</option>}
                {status.models.map((model) => (
                  <option key={model.id} value={model.model} className="bg-[#11151f]">
                    {model.displayName}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-zinc-600" />
            </div>
          </section>

          <section className="mt-auto rounded-xl border border-white/7 bg-black/15 p-3">
            <div className="flex items-center gap-2.5">
              {status.connecting ? (
                <LoaderCircleIcon className="size-4 animate-spin text-cyan-300" />
              ) : status.connected ? (
                <CheckCircle2Icon className="size-4 text-emerald-400" />
              ) : (
                <CircleAlertIcon className="size-4 text-red-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-zinc-300">
                  {status.connecting
                    ? "正在连接 Codex"
                    : status.connected
                      ? "本机 Codex 已连接"
                      : "连接失败"}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-zinc-600">
                  {status.connected ? accountLabel : status.error}
                </div>
              </div>
              {!status.connected && !status.connecting && (
                <button
                  type="button"
                  onClick={() => void connect()}
                  className="text-zinc-500 hover:text-white"
                  aria-label="重试连接"
                >
                  <RefreshCwIcon className="size-3.5" />
                </button>
              )}
            </div>
            {needsLogin && (
              <button
                type="button"
                onClick={() => void window.codex.login()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-zinc-950 hover:bg-zinc-200"
              >
                <LogInIcon className="size-3.5" />
                登录 ChatGPT
              </button>
            )}
          </section>
        </div>
        <div className="shrink-0 border-t border-white/7 p-3">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
          >
            <Settings2Icon className="size-4" />
            <span className="flex-1">设置</span>
            <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-1 text-[9px] text-zinc-600">
              {theme === "dark" ? <MoonIcon className="size-3" /> : <SunIcon className="size-3" />}
              {theme === "dark" ? "黑夜" : "白天"}
            </span>
          </button>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(45,212,191,0.11),transparent_38%)]" />
        {mode === "solo" && (
          <header className="electron-drag relative z-10 flex h-16 items-center justify-between border-b border-white/7 px-6">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <BotIcon className="size-4 text-cyan-300" />
              <span>Codex</span>
              {workspace && <span className="text-zinc-700">/</span>}
              {workspace && (
                <span className="max-w-64 truncate text-zinc-600">{shortPath(workspace)}</span>
              )}
            </div>
            <div className="rounded-full border border-emerald-400/12 bg-emerald-400/5 px-3 py-1 font-mono text-[9px] tracking-[0.14em] text-emerald-300/70 uppercase">
              workspace write · ask first
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
                  <LoaderCircleIcon className="mx-auto size-7 animate-spin text-cyan-300" />
                ) : (
                  <CircleAlertIcon className="mx-auto size-7 text-zinc-600" />
                )}
                <h2 className="mt-4 text-base font-medium text-zinc-200">
                  {status.connecting
                    ? "正在启动本机 Codex…"
                    : needsLogin
                      ? "需要登录 Codex"
                      : !workspace
                        ? "请选择项目目录"
                        : "Codex 暂不可用"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
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
    localStorage.getItem("codex.theme") === "light" ? "light" : "dark",
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
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-sm font-bold text-slate-950 shadow-[0_12px_40px_rgba(45,212,191,0.22)]">
            CX
          </div>
          <LoaderCircleIcon className="mx-auto mt-5 size-4 animate-spin text-cyan-300" />
          <p className="mt-3 text-xs text-zinc-600">正在验证登录状态…</p>
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
