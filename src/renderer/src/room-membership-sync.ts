export const missingSavedRoomAgentIds = ({
  requestedAgentIds,
  pendingAgentIds,
  syncedAgentIds,
}: {
  requestedAgentIds: string[];
  pendingAgentIds: string[];
  syncedAgentIds: string[];
}) => {
  const pending = new Set(pendingAgentIds);
  const synced = new Set(syncedAgentIds);
  return [...new Set(requestedAgentIds)].filter((id) => !pending.has(id) && !synced.has(id));
};
