import type { Metadata } from "next";

import { WorkTeamDesignSystem } from "./_components/workteam-design-system";

export const metadata: Metadata = {
  title: "WorkTeam Design System · Governed Collaboration",
  description: "WorkTeam 的飞书式视觉语言、shadcn 组件规范与人机协作治理模式。",
};

export default function DesignSystemPage() {
  return <WorkTeamDesignSystem />;
}
