import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CodexAttachment } from "../../shared/codex";

type AttachmentContextValue = {
  cwd: string;
  attachments: CodexAttachment[];
  pick: () => Promise<CodexAttachment[]>;
  remove: (id: string) => void;
  clear: () => void;
};

const CodexAttachmentContext = createContext<AttachmentContextValue | null>(null);

export const CodexAttachmentProvider = ({
  cwd,
  children,
}: {
  cwd: string;
  children: ReactNode;
}) => {
  const [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        void window.codex
          .discardAttachment({ cwd: attachment.cwd ?? cwd, attachment })
          .catch(() => undefined);
      }
    },
    [cwd],
  );
  const value = useMemo<AttachmentContextValue>(
    () => ({
      cwd,
      attachments,
      pick: async () => {
        const picked = await window.codex.pickAttachments({ cwd });
        setAttachments((current) => [...current, ...picked]);
        return picked;
      },
      remove: (id) =>
        setAttachments((current) => {
          const attachment = current.find((item) => item.id === id);
          if (attachment) {
            void window.codex
              .discardAttachment({ cwd: attachment.cwd ?? cwd, attachment })
              .catch(() => undefined);
          }
          return current.filter((item) => item.id !== id);
        }),
      clear: () => setAttachments([]),
    }),
    [attachments, cwd],
  );
  return (
    <CodexAttachmentContext.Provider value={value}>{children}</CodexAttachmentContext.Provider>
  );
};

export const useCodexAttachments = () => {
  const value = useContext(CodexAttachmentContext);
  if (!value) throw new Error("CodexAttachmentProvider 缺失。");
  return value;
};
