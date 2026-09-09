import type { Metadata } from "next";

import { WorkTeamDesignSystem } from "./_components/workteam-design-system";

export const metadata: Metadata = {
  title: "WorkTeam Design System · Feishu × shadcn",
  description: "基于飞书设计语言、使用 shadcn 实现的 WorkTeam 产品设计系统。",
};

export default function DesignSystemPage() {
  return <WorkTeamDesignSystem />;
}
