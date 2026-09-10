import type { TeamRoomSnapshot } from "../../shared/agent-team";

export type ConversationListPreferences = {
  pinnedAt: Record<string, number>;
  hiddenThrough: Record<string, number>;
};

export const emptyConversationListPreferences = (): ConversationListPreferences => ({
  pinnedAt: {},
  hiddenThrough: {},
});

export const conversationListStorageKey = (workspace: string) =>
  `codex.team-conversation-list:${workspace}`;

const finiteRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        Boolean(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
};

export const parseConversationListPreferences = (
  raw: string | null,
): ConversationListPreferences => {
  if (!raw) return emptyConversationListPreferences();
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      pinnedAt: finiteRecord(value.pinnedAt),
      hiddenThrough: finiteRecord(value.hiddenThrough),
    };
  } catch {
    return emptyConversationListPreferences();
  }
};

export const conversationActivity = (room: TeamRoomSnapshot) =>
  room.messages.at(-1)?.updatedAt ?? room.createdAt;

export const orderVisibleConversations = (
  rooms: TeamRoomSnapshot[],
  preferences: ConversationListPreferences,
) =>
  rooms
    .filter(
      (room) => conversationActivity(room) > (preferences.hiddenThrough[room.roomId] ?? -Infinity),
    )
    .sort((a, b) => {
      const pinnedA = preferences.pinnedAt[a.roomId] ?? 0;
      const pinnedB = preferences.pinnedAt[b.roomId] ?? 0;
      if (Boolean(pinnedA) !== Boolean(pinnedB)) return pinnedB ? 1 : -1;
      if (pinnedA && pinnedB && pinnedA !== pinnedB) return pinnedB - pinnedA;
      return conversationActivity(b) - conversationActivity(a);
    });

export const setConversationPinned = (
  preferences: ConversationListPreferences,
  roomId: string,
  pinned: boolean,
  now = Date.now(),
): ConversationListPreferences => {
  const pinnedAt = { ...preferences.pinnedAt };
  if (pinned) pinnedAt[roomId] = now;
  else delete pinnedAt[roomId];
  return { ...preferences, pinnedAt };
};

export const hideConversation = (
  preferences: ConversationListPreferences,
  room: TeamRoomSnapshot,
): ConversationListPreferences => {
  const next = setConversationPinned(preferences, room.roomId, false);
  return {
    ...next,
    hiddenThrough: {
      ...next.hiddenThrough,
      [room.roomId]: conversationActivity(room),
    },
  };
};

export const restoreConversation = (
  preferences: ConversationListPreferences,
  roomId: string,
): ConversationListPreferences => {
  const hiddenThrough = { ...preferences.hiddenThrough };
  delete hiddenThrough[roomId];
  return { ...preferences, hiddenThrough };
};
