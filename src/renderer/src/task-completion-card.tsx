import { CheckCircle2Icon, FolderKanbanIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { AgentTask } from "../../shared/agent-team";
import { normalizeCompletionArtifactRefs } from "../../shared/task-completion-summary";

export function TaskCompletionCard({
  task,
  artifactRefs,
  onOpenTask,
}: {
  task: AgentTask;
  artifactRefs: string[];
  onOpenTask: (task: AgentTask) => void;
}) {
  const safeArtifactRefs = normalizeCompletionArtifactRefs(artifactRefs);
  return (
    <Card size="sm" className="mt-3 max-w-md" data-testid="task-completion-card">
      <CardHeader>
        <CardTitle>Task 已完成</CardTitle>
        <CardDescription className="truncate">{task.title}</CardDescription>
        <CardAction>
          <Badge variant="secondary">
            <CheckCircle2Icon />
            已验收
          </Badge>
        </CardAction>
      </CardHeader>
      {!!safeArtifactRefs.length && (
        <CardContent>
          <p className="text-xs font-medium text-foreground">产物</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
            {safeArtifactRefs.map((artifact) => (
              <li key={artifact} className="truncate">
                {artifact}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      <CardFooter>
        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenTask(task)}>
          <FolderKanbanIcon data-icon="inline-start" />
          查看 Task
        </Button>
      </CardFooter>
    </Card>
  );
}
