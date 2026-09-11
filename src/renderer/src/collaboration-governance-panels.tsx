import {
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardIcon,
  Clock3Icon,
  FolderGit2Icon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  MonitorCogIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  WorkflowIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  AgentTask,
  PermissionConstraints,
  PermissionScope,
  RoomMemberRole,
  TeamWorkspaceSnapshot,
  WorkspaceBindingSummary,
} from "../../shared/agent-team";
import { formatErrorMessage } from "../../shared/error";

export type SharedWorkspaceBinding = WorkspaceBindingSummary & { active?: boolean };

export type ApprovalInboxItem = {
  id: string;
  taskId: string;
  taskRevision: number;
  runId: string;
  agentId: string;
  requestedScope: PermissionScope;
  requestedConstraints?: PermissionConstraints;
  summary: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string | number;
  expiresAt: string | number;
};

export type CollaborationAuditItem = {
  id: string;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  eventType: string;
  summary: string;
  outcome: string;
  createdAt: string | number;
};

const scopeLabels: Record<PermissionScope, string> = {
  "workspace.read": "读取项目文件",
  "workspace.write": "修改项目文件",
  "command.run": "运行命令",
  "network.read": "读取网络",
};

const roleLabels: Record<RoomMemberRole, string> = {
  owner: "群主",
  admin: "管理员",
  member: "成员",
};

const waitGuidance: Partial<Record<AgentTask["status"], string>> = {
  waiting_for_host: "请等待项目主机上线，或由管理员切换当前项目主机。",
  waiting_for_permission: "需要项目主机所有者核对范围后授权。",
  waiting_for_approval: "主机所有者需要处理一项具体电脑操作。",
  waiting_for_assignee: "请重新选择仍在群内且能力匹配的 Agent。",
  waiting_for_budget: "根 Task 已达到深度、子任务、运行次数或时长预算。",
  blocked: "先处理阻塞的必需子 Task，再继续父 Task。",
};

const dateTime = (value: string | number) => {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed)
    : "未知时间";
};

export const redactGovernanceText = (value: string) =>
  value
    .replace(/(?:\/Users|\/home|\/var\/folders|[A-Za-z]:\\)[^\s,;，；]+/g, "[本机路径]")
    .replace(/\b(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .slice(0, 1_000);

const constraintLines = (approval: ApprovalInboxItem) => {
  const constraints = approval.requestedConstraints ?? {};
  if (approval.requestedScope === "command.run") {
    return (constraints.commandExecutables ?? []).map((value) => `命令：${value}`);
  }
  if (approval.requestedScope === "network.read") {
    return (constraints.networkDomains ?? []).map((value) => `域名：${value}`);
  }
  return (constraints.pathPrefixes ?? []).map((value) => `相对路径：${value}`);
};

export function HostBindingDialog({
  open,
  workspace,
  roomId,
  roomRevision,
  role,
  currentUserId,
  currentBinding,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  workspace: string;
  roomId: string;
  roomRevision: number;
  role?: RoomMemberRole;
  currentUserId?: string;
  currentBinding?: WorkspaceBindingSummary;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [bindings, setBindings] = useState<SharedWorkspaceBinding[]>([]);
  const [label, setLabel] = useState(
    () => workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? "项目",
  );
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [baselineScopes, setBaselineScopes] = useState<PermissionScope[]>(["workspace.read"]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError("");
    try {
      const response = await window.backend.request<{ data: SharedWorkspaceBinding[] }>({
        path: `/v1/rooms/${encodeURIComponent(roomId)}/workspace-bindings`,
      });
      setBindings(response.data);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [open, roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const register = async () => {
    setSaving(true);
    setError("");
    try {
      const binding = await window.backend.registerWorkspaceBinding({
        workspace,
        label: label.trim(),
        repositoryUrl: repositoryUrl.trim() || null,
        baselineScopes,
      });
      await window.backend.request({
        method: "POST",
        path: `/v1/workspace-bindings/${encodeURIComponent(binding.id)}/share`,
        body: { roomId },
      });
      await refresh();
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };

  const canAdmin = role === "owner" || role === "admin";
  const setScope = (scope: PermissionScope, enabled: boolean) => {
    if (scope === "workspace.read") return;
    setBaselineScopes((current) =>
      enabled ? [...new Set([...current, scope])] : current.filter((item) => item !== scope),
    );
  };

  const activate = async (binding: SharedWorkspaceBinding) => {
    setSaving(true);
    setError("");
    try {
      await window.backend.request({
        method: "PUT",
        path: `/v1/rooms/${encodeURIComponent(roomId)}/workspace-binding`,
        headers: { "if-match": String(roomRevision) },
        body: { bindingId: binding.id },
      });
      await onChanged();
      onOpenChange(false);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>项目主机</DialogTitle>
          <DialogDescription>
            群里只共享项目标签、仓库身份、所有者、版本和在线状态；绝对路径仅加密保存在你的电脑上。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          <section aria-label="已共享的项目主机" className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">群内可用主机</h3>
              <Button type="button" variant="ghost" size="xs" onClick={() => void refresh()}>
                刷新
              </Button>
            </div>
            {loading ? (
              <div className="flex h-28 items-center justify-center text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" aria-label="正在加载项目主机" />
              </div>
            ) : bindings.length ? (
              <div className="space-y-2">
                {bindings.map((binding) => {
                  const active = binding.active || currentBinding?.id === binding.id;
                  return (
                    <Card key={binding.id} size="sm" className={cn(active && "border-primary/40")}>
                      <CardHeader>
                        <div className="flex items-center gap-2">
                          <FolderGit2Icon className="size-4 text-muted-foreground" />
                          <CardTitle>{binding.label}</CardTitle>
                          {active && <Badge variant="secondary">当前</Badge>}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {binding.repositoryUrl || "未设置仓库身份"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                          <Badge variant="outline">
                            所有者{" "}
                            {binding.hostUserId === currentUserId ? "我" : binding.hostUserId}
                          </Badge>
                          <Badge variant="outline">v{binding.revision}</Badge>
                          <Badge
                            variant="outline"
                            className={
                              binding.status === "online" ? "text-success" : "text-warning"
                            }
                          >
                            {binding.status === "online" ? "在线" : "离线"}
                          </Badge>
                        </div>
                        {!active && canAdmin && (
                          <Button
                            type="button"
                            size="xs"
                            disabled={saving}
                            onClick={() => void activate(binding)}
                          >
                            设为当前主机
                          </Button>
                        )}
                        {!active && !canAdmin && (
                          <p className="text-[10px] text-muted-foreground">
                            请群主或管理员将它设为当前主机。
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-5 text-center">
                <MonitorCogIcon className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 text-xs font-medium">群里还没有项目主机</p>
                <p className="mt-1 text-[11px] text-muted-foreground">先在右侧登记这台电脑。</p>
              </div>
            )}
          </section>
          <section
            aria-label="登记这台电脑"
            className="rounded-lg border border-border bg-muted/20 p-4"
          >
            <h3 className="text-sm font-medium">登记这台电脑</h3>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              默认仅允许读取。额外能力先由主机声明边界，每个 Task 仍需单独审核和授权。
            </p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="binding-label">项目标签</Label>
                <Input
                  id="binding-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="例如 Agent Team"
                />
              </div>
              <div className="space-y-2 rounded-md border border-border bg-background p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium">读取项目文件</p>
                    <p className="text-[10px] text-muted-foreground">首发必需，始终启用</p>
                  </div>
                  <Switch checked disabled aria-label="读取项目文件" />
                </div>
                {(
                  [
                    ["workspace.write", "修改项目文件"],
                    ["command.run", "运行命令"],
                    ["network.read", "读取有限网络"],
                  ] as Array<[PermissionScope, string]>
                ).map(([scope, scopeLabel]) => (
                  <div key={scope} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`binding-scope-${scope}`} className="text-xs font-normal">
                      {scopeLabel}
                    </Label>
                    <Switch
                      id={`binding-scope-${scope}`}
                      checked={baselineScopes.includes(scope)}
                      onCheckedChange={(checked) => setScope(scope, checked)}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="binding-repository">仓库身份（可选）</Label>
                <Input
                  id="binding-repository"
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                  placeholder="github.com/org/repo"
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={saving || !label.trim()}
                onClick={() => void register()}
              >
                {saving && <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />}
                登记并分享到群
              </Button>
            </div>
          </section>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalInboxDialog({
  open,
  approvals,
  loading,
  onOpenChange,
  onRefresh,
  onDecision,
}: {
  open: boolean;
  approvals: ApprovalInboxItem[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onDecision: (
    approval: ApprovalInboxItem,
    decision: "deny" | "allow_once" | "allow_for_task",
  ) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<{
    approval: ApprovalInboxItem;
    decision: "deny" | "allow_once" | "allow_for_task";
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = approvals.filter((approval) => approval.status === "pending");
  const confirm = async () => {
    if (!confirming) return;
    setSaving(true);
    setError("");
    try {
      await onDecision(confirming.approval, confirming.decision);
      setConfirming(null);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>电脑操作审批</DialogTitle>
            <DialogDescription>
              只有项目主机所有者能看到并处理具体操作；群成员只会看到脱敏后的等待状态。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{pending.length} 项待处理</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => void onRefresh()}>
              刷新
            </Button>
          </div>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : pending.length ? (
            <div className="space-y-3">
              {pending.map((approval) => (
                <Card key={approval.id} size="sm">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <ShieldAlertIcon className="size-4 text-warning" />
                      <CardTitle>{scopeLabels[approval.requestedScope]}</CardTitle>
                      <Badge variant="outline">Task v{approval.taskRevision}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs leading-5">{redactGovernanceText(approval.summary)}</p>
                    <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground">
                      {(constraintLines(approval).length
                        ? constraintLines(approval)
                        : ["范围：仅限本次请求中的精确操作"]
                      ).map((line) => (
                        <div key={line}>{redactGovernanceText(line)}</div>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => setConfirming({ approval, decision: "deny" })}
                      >
                        拒绝
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => setConfirming({ approval, decision: "allow_once" })}
                      >
                        仅这一次
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        onClick={() => setConfirming({ approval, decision: "allow_for_task" })}
                      >
                        本 Task
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <ShieldCheckIcon className="mx-auto size-5 text-success" />
              <p className="mt-2 text-xs font-medium">没有待处理操作</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(confirming)} onOpenChange={(next) => !next && setConfirming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认审批决定</DialogTitle>
            <DialogDescription>
              {confirming?.decision === "deny"
                ? "拒绝后，本次 Runtime 操作会失败关闭。"
                : confirming?.decision === "allow_once"
                  ? "只恢复当前这一个 Runtime 请求，不会扩大后续权限。"
                  : "在当前 Task、revision、主机和精确约束内复用授权；Task 变化后自动失效。"}
            </DialogDescription>
          </DialogHeader>
          {confirming && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <div className="font-medium">{scopeLabels[confirming.approval.requestedScope]}</div>
              <div className="mt-1 text-muted-foreground">
                {redactGovernanceText(confirming.approval.summary)}
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              取消
            </Button>
            <Button type="button" disabled={saving} onClick={() => void confirm()}>
              {saving && <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TaskGrantDialog({
  open,
  task,
  onOpenChange,
  onGrant,
}: {
  open: boolean;
  task?: AgentTask;
  onOpenChange: (open: boolean) => void;
  onGrant: (scopes: PermissionScope[], constraints: PermissionConstraints) => Promise<void>;
}) {
  const [paths, setPaths] = useState(".");
  const [commands, setCommands] = useState("npm,node,git");
  const [domains, setDomains] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const scopes = (task?.requestedScopes ?? []).filter((scope) => scope !== "workspace.read");
  const split = (value: string) => [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await onGrant(scopes, {
        ...(scopes.includes("workspace.write") ? { pathPrefixes: split(paths) } : {}),
        ...(scopes.includes("command.run") ? { commandExecutables: split(commands) } : {}),
        ...(scopes.includes("network.read") ? { networkDomains: split(domains) } : {}),
      });
      onOpenChange(false);
    } catch (nextError) {
      setError(formatErrorMessage(nextError));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>授权当前 Task 范围</DialogTitle>
          <DialogDescription>
            授权只绑定当前 Task revision 和项目主机。请输入最小相对路径、命令或域名范围。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((scope) => (
              <Badge key={scope} variant="outline">
                {scopeLabels[scope]}
              </Badge>
            ))}
          </div>
          {scopes.includes("workspace.write") && (
            <div className="space-y-1.5">
              <Label htmlFor="grant-paths">允许的相对路径（逗号分隔）</Label>
              <Input
                id="grant-paths"
                value={paths}
                onChange={(event) => setPaths(event.target.value)}
              />
            </div>
          )}
          {scopes.includes("command.run") && (
            <div className="space-y-1.5">
              <Label htmlFor="grant-commands">允许的可执行文件（逗号分隔）</Label>
              <Input
                id="grant-commands"
                value={commands}
                onChange={(event) => setCommands(event.target.value)}
              />
            </div>
          )}
          {scopes.includes("network.read") && (
            <div className="space-y-1.5">
              <Label htmlFor="grant-domains">允许读取的域名（逗号分隔）</Label>
              <Input
                id="grant-domains"
                value={domains}
                onChange={(event) => setDomains(event.target.value)}
                placeholder="api.example.com"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={saving || !scopes.length} onClick={() => void submit()}>
            {saving && <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />}
            创建 Task 授权
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskInspector({
  task,
  state,
  role,
  currentUserId,
  onOpenTask,
  onReview,
  onStart,
  onGrant,
  onComplete,
}: {
  task: AgentTask;
  state: TeamWorkspaceSnapshot;
  role?: RoomMemberRole;
  currentUserId?: string;
  onOpenTask: (task: AgentTask) => void;
  onReview: (decision: "approved" | "changes_requested") => void;
  onStart: () => void;
  onGrant: () => void;
  onComplete: () => void;
}) {
  const children = state.tasks.filter((candidate) => candidate.parentTaskId === task.id);
  const assignees = state.agents.filter((agent) => task.assigneeIds.includes(agent.id));
  const canAdmin = task.syncSource !== "backend" || role === "owner" || role === "admin";
  const isHostOwner =
    task.syncSource !== "backend" ||
    task.workspaceBinding?.hostUserId === (currentUserId ?? "local_user");
  const budget = task.budget;
  const usage = task.budgetUsage;
  return (
    <div className="space-y-4" data-testid="task-inspector">
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">执行治理</h3>
          <Badge variant="outline">{role ? roleLabels[role] : "本机所有者"}</Badge>
        </div>
        {task.waitReason && (
          <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-2.5">
            <div className="flex items-start gap-2 text-xs text-warning">
              <Clock3Icon className="mt-0.5 size-3.5 shrink-0" />
              <span>{redactGovernanceText(task.waitReason)}</span>
            </div>
            {waitGuidance[task.status] && (
              <p className="mt-1 pl-5 text-[10px] leading-4 text-muted-foreground">
                {waitGuidance[task.status]}
              </p>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Task tree
        </h3>
        <div className="mt-2 rounded-md border border-border">
          <div className="flex items-center gap-2 bg-muted/30 px-2.5 py-2 text-xs font-medium">
            <WorkflowIcon className="size-3.5 text-primary" />
            <span className="min-w-0 flex-1 truncate">{task.title}</span>
            <Badge variant="outline">L{task.depth ?? 0}</Badge>
          </div>
          {children.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => onOpenTask(child)}
              className="flex w-full items-center gap-2 border-t border-border px-2.5 py-2 text-left text-[11px] hover:bg-muted/40"
            >
              <ChevronRightIcon className="size-3 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{child.title}</span>
              <Badge variant="outline">{child.status}</Badge>
            </button>
          ))}
          {!children.length && (
            <p className="border-t border-border px-2.5 py-2 text-[10px] text-muted-foreground">
              暂无子 Task
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Assignees & scopes
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {assignees.map((agent) => (
            <Badge key={agent.id} variant="secondary">
              {agent.name}
            </Badge>
          ))}
          {(task.requestedScopes ?? []).map((scope) => (
            <Badge key={scope} variant="outline">
              {scopeLabels[scope]}
            </Badge>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Project host
        </h3>
        <div className="mt-2 rounded-md border border-border bg-muted/20 p-2.5">
          {task.workspaceBinding ? (
            <>
              <div className="flex items-center gap-2 text-xs font-medium">
                <MonitorCogIcon className="size-3.5" />
                {task.workspaceBinding.label}
                <span
                  className={
                    task.workspaceBinding.status === "online" ? "text-success" : "text-warning"
                  }
                >
                  {task.workspaceBinding.status === "online" ? "在线" : "离线"}
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] text-muted-foreground">
                {task.workspaceBinding.repositoryUrl || "无仓库身份"} · v
                {task.workspaceBindingRevision ?? task.workspaceBinding.revision}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-warning">尚未绑定项目主机</p>
          )}
        </div>
      </section>

      {budget && usage && (
        <section>
          <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Root budget
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
            {[
              ["层级", task.depth ?? 0, budget.maxDepth],
              ["子 Task", usage.descendants, budget.maxDescendants],
              ["Runs", usage.runs, budget.maxRuns],
              ["时长", Math.max(0, Date.now() - usage.startedAt), budget.maxWallTimeMs],
            ].map(([label, value, max]) => (
              <div key={String(label)} className="rounded-md border border-border bg-muted/20 p-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>{label}</span>
                  <span>
                    {Number(value)}/{Number(max)}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (Number(value) / Number(max)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!!task.artifactRefs?.length && (
        <section>
          <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Artifacts
          </h3>
          <div className="mt-2 space-y-1">
            {task.artifactRefs.map((artifact) => (
              <div
                key={artifact}
                className="truncate rounded-md bg-muted/30 px-2 py-1.5 font-mono text-[10px]"
              >
                {redactGovernanceText(artifact)}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-2">
        {canAdmin && (task.status === "pending_review" || task.status === "changes_requested") && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onReview("changes_requested")}
            >
              退回修改
            </Button>
            <Button type="button" size="xs" onClick={() => onReview("approved")}>
              审核通过
            </Button>
          </div>
        )}
        {isHostOwner && task.status === "waiting_for_permission" && (
          <Button type="button" size="xs" onClick={onGrant}>
            <LockKeyholeIcon data-icon="inline-start" />
            授权当前 Task 范围
          </Button>
        )}
        {canAdmin && task.status === "approved" && (
          <Button type="button" size="xs" onClick={onStart}>
            开始执行
          </Button>
        )}
        {canAdmin && task.status === "review" && (
          <Button type="button" size="xs" onClick={onComplete}>
            <CheckCircle2Icon data-icon="inline-start" />
            验收完成
          </Button>
        )}
        {!canAdmin && (
          <p className="rounded-md bg-muted/30 p-2 text-[10px] text-muted-foreground">
            你可以参与讨论和请求 Task；审核、开始与状态变更由群主或管理员处理。
          </p>
        )}
      </section>
    </div>
  );
}

export function AuditTimeline({ items }: { items: CollaborationAuditItem[] }) {
  const safeItems = useMemo(
    () => items.map((item) => ({ ...item, summary: redactGovernanceText(item.summary) })),
    [items],
  );
  const copyDiagnostics = async () => {
    await navigator.clipboard.writeText(
      JSON.stringify(
        safeItems.map(({ id, eventType, summary, outcome, createdAt }) => ({
          id,
          eventType,
          summary,
          outcome,
          createdAt,
        })),
        null,
        2,
      ),
    );
  };
  return (
    <section data-testid="governance-audit">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Activity & audit
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void copyDiagnostics()}
          aria-label="复制脱敏诊断"
        >
          <ClipboardIcon />
        </Button>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {safeItems.slice(0, 12).map((item) => (
          <div key={item.id} className="flex gap-2 rounded-md px-2 py-2 hover:bg-muted/40">
            {item.outcome === "blocked" || item.outcome === "failed" ? (
              <XCircleIcon className="mt-0.5 size-3 shrink-0 text-destructive" />
            ) : item.outcome === "pending" ? (
              <Clock3Icon className="mt-0.5 size-3 shrink-0 text-warning" />
            ) : (
              <CheckCircle2Icon className="mt-0.5 size-3 shrink-0 text-success" />
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[10px] leading-4 text-foreground">{item.summary}</p>
              <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                {item.eventType} · {dateTime(item.createdAt)}
              </p>
            </div>
          </div>
        ))}
        {!safeItems.length && (
          <p className="px-2 py-4 text-center text-[10px] text-muted-foreground">暂无治理事件</p>
        )}
      </div>
    </section>
  );
}
