import type { Metadata } from "next";

import { CodexDesktopDesignSystem } from "./_components/workteam-design-system";

export const metadata: Metadata = {
  title: "Codex Desktop Design System · Governed Collaboration",
  description: "Codex Desktop 的协作视觉语言、shadcn 工程规范与人机协作治理模式。",
};

export default function DesignSystemPage() {
  return <CodexDesktopDesignSystem />;
}
