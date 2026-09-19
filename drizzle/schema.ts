import { int, mysqlEnum, mysqlTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 180 }).notNull(),
  acronym: varchar("acronym", { length: 32 }),
  description: text("description"),
  ownerId: int("ownerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const organizationMembers = mysqlTable("organizationMembers", {
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "contributor", "viewer"]).default("contributor").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.organizationId, table.userId] }),
}));

export const assessments = mysqlTable("assessments", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  status: mysqlEnum("status", ["draft", "active", "completed"]).default("draft").notNull(),
  createdBy: int("createdBy").notNull(),
  assessedAt: timestamp("assessedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const assessmentResponses = mysqlTable("assessmentResponses", {
  id: int("id").autoincrement().primaryKey(),
  assessmentId: int("assessmentId").notNull(),
  code: varchar("code", { length: 8 }).notNull(),
  dimension: varchar("dimension", { length: 80 }).notNull(),
  criterion: text("criterion").notNull(),
  evidenceExpected: text("evidenceExpected").notNull(),
  score: int("score"),
  evidenceObserved: text("evidenceObserved"),
  gap: text("gap"),
  responsible: varchar("responsible", { length: 180 }),
  dueDate: timestamp("dueDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const initiatives = mysqlTable("initiatives", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  assessmentId: int("assessmentId"),
  name: varchar("name", { length: 180 }).notNull(),
  dimension: varchar("dimension", { length: 80 }).notNull(),
  criterionCode: varchar("criterionCode", { length: 8 }),
  problem: text("problem"),
  minimumProduct: text("minimumProduct"),
  owner: varchar("owner", { length: 180 }),
  valueScore: int("valueScore"),
  riskScore: int("riskScore"),
  urgencyScore: int("urgencyScore"),
  feasibilityScore: int("feasibilityScore"),
  dependencyScore: int("dependencyScore"),
  priorityScore: int("priorityScore"),
  status: mysqlEnum("status", ["not_started", "in_progress", "blocked", "completed", "cancelled"]).default("not_started").notNull(),
  dueDate: timestamp("dueDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const kpis = mysqlTable("kpis", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  code: varchar("code", { length: 12 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  definition: text("definition"),
  currentValue: int("currentValue"),
  targetValue: int("targetValue"),
  unit: varchar("unit", { length: 24 }),
  trend: mysqlEnum("trend", ["improving", "stable", "declining", "no_data"]).default("no_data").notNull(),
  decisionTrigger: text("decisionTrigger"),
  decision: text("decision"),
  measuredAt: timestamp("measuredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const risks = mysqlTable("risks", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  cause: text("cause"),
  effect: text("effect"),
  probability: int("probability"),
  impact: int("impact"),
  exposure: int("exposure"),
  response: text("response"),
  owner: varchar("owner", { length: 180 }),
  status: mysqlEnum("status", ["open", "mitigated", "accepted", "closed"]).default("open").notNull(),
  dueDate: timestamp("dueDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const organizationInvites = mysqlTable("organizationInvites", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["admin", "contributor", "viewer"]).default("contributor").notNull(),
  token: varchar("token", { length: 96 }).notNull().unique(),
  invitedBy: int("invitedBy").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "revoked"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  actorId: int("actorId").notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: int("entityId"),
  summary: varchar("summary", { length: 500 }).notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["deadline", "invite", "system"]).default("system").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  message: text("message").notNull(),
  entityType: varchar("entityType", { length: 80 }),
  entityId: int("entityId"),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
