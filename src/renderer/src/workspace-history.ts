const MAX_WORKSPACES = 12;

export const normalizeWorkspaceHistory = (activeWorkspace: string, stored: unknown) => {
  const candidates = [
    activeWorkspace,
    ...(Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === "string")
      : []),
  ];

  return candidates
    .filter((path) => path.length > 0)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .slice(0, MAX_WORKSPACES);
};

export const rememberWorkspace = (workspaces: string[], path: string) =>
  normalizeWorkspaceHistory(path, workspaces);
