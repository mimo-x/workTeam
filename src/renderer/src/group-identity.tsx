import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export const GroupIdentity = ({ roomId }: { roomId: string }) => {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const copyId = async () => {
    setCopyStatus("copying");
    try {
      await navigator.clipboard.writeText(roomId);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <div className="electron-no-drag flex min-w-0 flex-col text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1">
        <span className="shrink-0">群 ID：</span>
        <span className="truncate font-mono select-text" title={roomId}>
          {roomId}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => void copyId()}
          disabled={copyStatus === "copying"}
          aria-label="复制群 ID"
          title={copyStatus === "copied" ? "群 ID 已复制" : "复制群 ID"}
        >
          {copyStatus === "copied" ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <span role="status" className={copyStatus === "error" ? "text-destructive" : "sr-only"}>
        {copyStatus === "copied"
          ? "群 ID 已复制"
          : copyStatus === "error"
            ? "复制失败，请重试或手动复制群 ID。"
            : ""}
      </span>
    </div>
  );
};
