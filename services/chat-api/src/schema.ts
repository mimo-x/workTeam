import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    avatarUrl: text("avatar_url"),
    openimUserId: text("openim_user_id").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_email_lower_uq").on(table.email),
    uniqueIndex("users_handle_lower_uq").on(table.handle),
    uniqueIndex("users_openim_user_id_uq").on(table.openimUserId),
  ],
);

export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    deviceName: text("device_name").notNull().default("Unknown device"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("refresh_sessions_token_hash_uq").on(table.tokenHash)],
);

export const accountTokens = pgTable(
  "account_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("account_tokens_hash_uq").on(table.tokenHash)],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    isAgentHost: boolean("is_agent_host").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [index("devices_user_idx").on(table.userId)],
);

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receiverId: uuid("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull().default(""),
    status: text("status").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("friend_requests_receiver_status_idx").on(table.receiverId, table.status),
    index("friend_requests_sender_status_idx").on(table.senderId, table.status),
  ],
);

export const friendships = pgTable(
  "friendships",
  {
    userLowId: uuid("user_low_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHighId: uuid("user_high_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userLowId, table.userHighId] })],
);

export type EncryptedEnvelope = {
  version: 1;
  algorithm: "A256GCM";
  keyProvider?: string;
  iv: string;
  tag: string;
  ciphertext: string;
  wrappedKey: string;
  wrappedKeyIv: string;
  wrappedKeyTag: string;
};

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    openimUserId: text("openim_user_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull().default("Agent"),
    mention: text("mention").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility").notNull().default("private"),
    workspaceAccess: text("workspace_access").notNull().default("read"),
    executionTarget: text("execution_target").notNull().default("local"),
    provider: text("provider").notNull().default("codex"),
    protocol: text("protocol").notNull().default("app-server"),
    runtimeModel: text("runtime_model"),
    runtimeEndpoint: text("runtime_endpoint"),
    runtimeCommand: text("runtime_command"),
    runtimeArgs: jsonb("runtime_args").$type<string[]>().notNull().default([]),
    runtimeAuth: text("runtime_auth").notNull().default("none"),
    capabilities: jsonb("capabilities")
      .$type<string[]>()
      .notNull()
      .default(["chat", "stream_progress", "read_workspace"]),
    runtimeStatus: text("runtime_status").notNull().default("offline"),
    runtimeLastSeenAt: timestamp("runtime_last_seen_at", { withTimezone: true }),
    skillPolicy: text("skill_policy").notNull().default("none"),
    skillRefs: jsonb("skill_refs")
      .$type<Array<{ name: string; path?: string }>>()
      .notNull()
      .default([]),
    privateConfig: jsonb("private_config").$type<EncryptedEnvelope>().notNull(),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("agents_openim_user_id_uq").on(table.openimUserId),
    index("agents_owner_idx").on(table.ownerId),
    index("agents_visibility_idx").on(table.visibility),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    openimGroupId: text("openim_group_id"),
    type: text("type").notNull(),
    name: text("name").notNull(),
    directKey: text("direct_key"),
    sourceRoomId: uuid("source_room_id"),
    revision: integer("revision").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("rooms_openim_group_id_uq").on(table.openimGroupId),
    uniqueIndex("rooms_direct_key_uq").on(table.directKey),
  ],
);

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.userId] })],
);

export const roomAgents = pgTable(
  "room_agents",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.agentId] })],
);

export const agentInvitations = pgTable(
  "agent_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("agent_invitations_agent_status_idx").on(table.agentId, table.status)],
);

export const messages = pgTable(
  "message_mirrors",
  {
    serverMsgId: text("server_msg_id").primaryKey(),
    clientMsgId: text("client_msg_id").notNull(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    openimConversationId: text("openim_conversation_id").notNull(),
    senderOpenimId: text("sender_openim_id").notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    senderAgentId: uuid("sender_agent_id").references(() => agents.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    contentType: integer("content_type").notNull().default(101),
    seq: bigint("seq", { mode: "number" }).notNull().default(0),
    targetAgentIds: jsonb("target_agent_ids").$type<string[]>().notNull().default([]),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("message_mirrors_client_msg_id_uq").on(table.clientMsgId),
    index("message_mirrors_room_seq_idx").on(table.roomId, table.seq),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    sourceRoomId: uuid("source_room_id")
      .notNull()
      .references(() => rooms.id),
    taskRoomId: uuid("task_room_id")
      .notNull()
      .references(() => rooms.id),
    anchorMessageId: text("anchor_message_id").notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull().default(""),
    expectedResult: text("expected_result").notNull().default(""),
    plan: jsonb("plan").$type<string[]>().notNull().default([]),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
    requestedAccess: text("requested_access").notNull().default("read"),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    proposedByAgentId: uuid("proposed_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending_review"),
    revision: integer("revision").notNull().default(1),
    approvalRequired: boolean("approval_required").notNull().default(true),
    approvedReviewId: uuid("approved_review_id"),
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    contextVersion: integer("context_version").notNull().default(1),
    latestSourceSeq: bigint("latest_source_seq", { mode: "number" }).notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tasks_anchor_message_uq").on(table.anchorMessageId),
    index("tasks_source_status_idx").on(table.sourceRoomId, table.status),
  ],
);

export const taskReviews = pgTable(
  "task_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    taskRevision: integer("task_revision").notNull(),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id),
    reviewerNameSnapshot: text("reviewer_name_snapshot").notNull(),
    decision: text("decision").notNull(),
    comment: text("comment").notNull().default(""),
    taskSnapshot: jsonb("task_snapshot").$type<Record<string, unknown>>().notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("task_reviews_task_reviewed_idx").on(table.taskId, table.reviewedAt)],
);

export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.agentId] })],
);

export const taskContextEvents = pgTable(
  "task_context_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    contextVersion: integer("context_version").notNull(),
    sourceSeq: bigint("source_seq", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("task_context_task_message_uq").on(table.taskId, table.messageId)],
);

export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    status: text("status").notNull().default("queued"),
    executionTarget: text("execution_target").notNull().default("local"),
    contextVersion: integer("context_version").notNull(),
    agentSnapshot: jsonb("agent_snapshot").$type<Record<string, unknown>>().notNull(),
    leaseTokenHash: text("lease_token_hash"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    outputMessageId: text("output_message_id"),
    approvalId: uuid("approval_id").references(() => taskReviews.id, { onDelete: "set null" }),
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("task_runs_dispatch_idx").on(table.status, table.executionTarget)],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceBindings = pgTable(
  "workspace_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    pathConfig: jsonb("path_config").$type<EncryptedEnvelope>().notNull(),
    repositoryUrl: text("repository_url"),
    ...timestamps,
  },
  (table) => [uniqueIndex("workspace_bindings_device_label_uq").on(table.deviceId, table.label)],
);

export const encryptedConfigs = pgTable(
  "encrypted_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id"),
    name: text("name").notNull(),
    value: jsonb("value").$type<EncryptedEnvelope>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("encrypted_configs_scope_name_uq").on(
      table.ownerId,
      table.scopeType,
      table.scopeId,
      table.name,
    ),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: text("topic").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outbox_pending_idx").on(table.processedAt, table.availableAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_actor_created_idx").on(table.actorId, table.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

export const legacyMappings = pgTable(
  "legacy_mappings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    legacyId: text("legacy_id").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.kind, table.legacyId] })],
);
