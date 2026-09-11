type BackendValidationIssue = {
  path?: Array<string | number>;
  message?: string;
};

export const formatBackendErrorDetails = (details: unknown) => {
  if (!Array.isArray(details)) return "";
  const messages = details
    .map((item) => item as BackendValidationIssue)
    .filter((item) => item && typeof item === "object" && typeof item.message === "string")
    .map((item) => {
      const path = item.path?.length ? item.path.join(".") : "请求";
      return `${path}: ${item.message}`;
    });
  return messages.length ? messages.join("；") : "";
};
