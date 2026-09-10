import type { Metadata } from "next";

import { CodexDesktopDesignSystem } from "./_components/workteam-design-system";

export const metadata: Metadata = {
  title: "Codex Desktop Design System · Calm Collaboration",
  description: "Codex Desktop 面向 Agent 协作场景的产品设计系统与 shadcn 工程规范。",
};

export default function DesignSystemPage() {
  return <CodexDesktopDesignSystem />;
}
