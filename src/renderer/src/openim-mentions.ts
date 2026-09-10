import type { AgentDefinition, HumanContact } from "../../shared/agent-team";

export type MentionCandidate = {
  id: string;
  name: string;
  title: string;
  mention: string;
  initials: string;
  kind: "agent" | "human";
  openimUserId?: string;
  description?: string;
  theme?: AgentDefinition["theme"];
};

export const buildMentionCandidates = (
  agents: AgentDefinition[],
  humans: HumanContact[],
): MentionCandidate[] => [
  ...agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    title: agent.title,
    mention: agent.mention,
    initials: agent.initials,
    kind: "agent" as const,
    openimUserId: agent.openimUserId,
    description: agent.description,
    theme: agent.theme,
  })),
  ...humans
    .filter((human) => human.id !== "local_user")
    .map((human) => ({
      id: human.id,
      name: human.name,
      title: human.title,
      mention: `@${human.handle ?? human.id}`,
      initials: human.initials,
      kind: "human" as const,
      openimUserId: human.openimUserId,
    })),
];

export const mentionedCandidates = (candidates: MentionCandidate[], text: string) =>
  candidates.filter(
    (candidate) => text.includes(candidate.mention) || text.includes(`@${candidate.id}`),
  );
