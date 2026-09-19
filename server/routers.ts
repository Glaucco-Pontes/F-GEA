import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { assessmentResponses, assessments, initiatives, kpis, notifications, organizationInvites, organizationMembers, risks, users } from "../drizzle/schema";
import { CRITERIA, DIMENSIONS, ensureWorkspace, getAssessmentData, getDb, getLocalMembershipRole, getLocalStore, getUserNotifications, getWorkspaceAudit, getWorkspaceMembers, getWorkspaceSnapshot, writeAuditLog } from "./db";

type WorkspaceRole = "owner" | "admin" | "contributor" | "viewer";

async function requireWorkspaceRole(userId: number, organizationId: number, allowed: WorkspaceRole[]) {
  const db = await getDb();
  if (!db) {
    const role = getLocalMembershipRole(organizationId, userId) as WorkspaceRole | undefined;
    if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pertence a este workspace" });
    if (!allowed.includes(role)) throw new TRPCError({ code: "FORBIDDEN", message: "Seu papel não permite esta operação" });
    return role;
  }

  const rows = await db.select({ role: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId))).limit(1);
  const role = rows[0]?.role as WorkspaceRole | undefined;
  if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "Você não pertence a este workspace" });
  if (!allowed.includes(role)) throw new TRPCError({ code: "FORBIDDEN", message: "Seu papel não permite esta operação" });
  return role;
}

async function ensureDeadlineNotifications(organizationId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  const now = Date.now();
  const horizon = now + 14 * 24 * 60 * 60 * 1000;
  const [initiativeRows, riskRows, existing] = await Promise.all([
    db.select().from(initiatives).where(eq(initiatives.organizationId, organizationId)),
    db.select().from(risks).where(eq(risks.organizationId, organizationId)),
    db.select({ entityType: notifications.entityType, entityId: notifications.entityId }).from(notifications).where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId), eq(notifications.type, "deadline"))),
  ]);
  const existingKeys = new Set(existing.map(item => `${item.entityType}:${item.entityId}`));
  const dueItems = [
    ...initiativeRows.filter(item => item.dueDate && item.dueDate.getTime() >= now && item.dueDate.getTime() <= horizon && !["completed", "cancelled"].includes(item.status)).map(item => ({ entityType: "initiative", entityId: item.id, title: "Prazo de iniciativa próximo", message: `${item.name} vence nos próximos 14 dias.` })),
    ...riskRows.filter(item => item.dueDate && item.dueDate.getTime() >= now && item.dueDate.getTime() <= horizon && !["closed", "mitigated"].includes(item.status)).map(item => ({ entityType: "risk", entityId: item.id, title: "Prazo de risco próximo", message: `${item.name} requer tratamento nos próximos 14 dias.` })),
  ];
  const fresh = dueItems.filter(item => !existingKeys.has(`${item.entityType}:${item.entityId}`));
  if (fresh.length) await db.insert(notifications).values(fresh.map(item => ({ organizationId, userId, type: "deadline" as const, ...item })));
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure.input(z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(320),
    })).mutation(async ({ ctx, input }) => {
      const normalizedName = input.name.trim();
      const normalizedEmail = input.email.trim().toLowerCase();
      const openId = `local:${normalizedEmail}`;
      const now = new Date();

      const sessionUser = {
        id: 0,
        openId,
        name: normalizedName,
        email: normalizedEmail,
        loginMethod: "local",
        role: "user",
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now,
      } satisfies typeof users.$inferSelect;

      const db = await getDb();
      if (db) {
        await db.insert(users).values({
          openId,
          name: normalizedName,
          email: normalizedEmail,
          loginMethod: "local",
          lastSignedIn: now,
          role: "user",
        }).onDuplicateKeyUpdate({
          set: {
            name: normalizedName,
            email: normalizedEmail,
            loginMethod: "local",
            lastSignedIn: now,
          },
        });
      } else {
        const localUser = {
          id: 1,
          openId,
          name: normalizedName,
          email: normalizedEmail,
          loginMethod: "local",
          role: "user",
          createdAt: now,
          updatedAt: now,
          lastSignedIn: now,
        };
        const existing = Array.from(getLocalStore().users.values()).find(item => item.openId === openId);
        if (existing) {
          Object.assign(existing, localUser);
        } else {
          getLocalStore().users.set(openId, localUser);
        }
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: normalizedName,
        expiresInMs: 1000 * 60 * 60 * 24 * 365,
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: 1000 * 60 * 60 * 24 * 365,
      });

      return {
        success: true,
        user: sessionUser,
      } as const;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  workspace: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Não foi possível criar o workspace");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin", "contributor", "viewer"]);
      const db = await getDb();
      if (db) {
        await ensureDeadlineNotifications(workspace.id, ctx.user.id);
      }
      const current = await getAssessmentData(workspace.id);
      if (!current.assessment && !db) {
        const created = {
          id: Math.max(1, getLocalStore().nextAssessmentId++),
          organizationId: workspace.id,
          title: "Diagnóstico inicial F-GEA",
          status: "active",
          createdBy: ctx.user.id,
          assessedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        getLocalStore().assessments.set(created.id, created);
        const responses = CRITERIA.map(([code, dimension, criterion, evidenceExpected], index) => ({
          id: getLocalStore().nextResponseId++,
          assessmentId: created.id,
          code,
          dimension,
          criterion,
          evidenceExpected,
          score: null,
          evidenceObserved: "",
          gap: index % 3 === 0 ? "Definir ação de melhoria para avançar no próximo ciclo." : "",
          responsible: "",
          dueDate: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        for (const item of responses) getLocalStore().responses.set(item.id, item);
      }
      const [assessmentData, snapshot, members, audit, userNotifications] = await Promise.all([getAssessmentData(workspace.id), getWorkspaceSnapshot(workspace.id), getWorkspaceMembers(workspace.id), getWorkspaceAudit(workspace.id), getUserNotifications(workspace.id, ctx.user.id)]);
      const dimensions = DIMENSIONS.map(name => {
        const items = assessmentData.responses.filter(item => item.dimension === name);
        const answered = items.filter(item => item.score !== null);
        const average = answered.length ? answered.reduce((total, item) => total + (item.score ?? 0), 0) / answered.length : 0;
        return { name, average: Math.round(average * 10) / 10, answered: answered.length, total: items.length };
      });
      const answered = assessmentData.responses.filter(item => item.score !== null).length;
      const criticalGaps = assessmentData.responses.filter(item => ["N2", "N4", "T2", "T4"].includes(item.code) && (item.score === null || item.score < 3));
      const currentMember = members.find(item => item.user.id === ctx.user.id)?.membership;
      return { workspace, assessment: assessmentData.assessment, responses: assessmentData.responses, dimensions, snapshot, members, audit, notifications: userNotifications, currentRole: currentMember?.role ?? "viewer", progress: { answered, total: assessmentData.responses.length, percentage: assessmentData.responses.length ? Math.round((answered / assessmentData.responses.length) * 100) : 0, criticalGaps: criticalGaps.length } };
    }),
    updateResponse: protectedProcedure.input(z.object({ id: z.number().int(), score: z.number().int().min(1).max(5).nullable().optional(), evidenceObserved: z.string().max(4000).optional(), gap: z.string().max(4000).optional(), responsible: z.string().max(180).optional() })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin", "contributor"]);
      const current = await getAssessmentData(workspace.id);
      if (!current.responses.some(item => item.id === input.id)) throw new Error("Critério não encontrado neste workspace");
      const db = await getDb();
      if (!db) {
        const response = getLocalStore().responses.get(input.id);
        if (!response) throw new Error("Critério não encontrado neste workspace");
        Object.assign(response, {
          score: input.score ?? null,
          evidenceObserved: input.evidenceObserved ?? response.evidenceObserved ?? "",
          gap: input.gap ?? response.gap ?? "",
          responsible: input.responsible ?? response.responsible ?? "",
          updatedAt: new Date(),
        });
        await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "update", entityType: "assessmentResponse", entityId: input.id, summary: `Atualizou o critério ${current.responses.find(item => item.id === input.id)?.code ?? ""}`, metadata: { score: input.score } });
        return { success: true } as const;
      }
      await db.update(assessmentResponses).set({ score: input.score ?? null, evidenceObserved: input.evidenceObserved, gap: input.gap, responsible: input.responsible }).where(eq(assessmentResponses.id, input.id));
      await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "update", entityType: "assessmentResponse", entityId: input.id, summary: `Atualizou o critério ${current.responses.find(item => item.id === input.id)?.code ?? ""}`, metadata: { score: input.score } });
      return { success: true } as const;
    }),
    inviteMember: protectedProcedure.input(z.object({ email: z.string().email(), role: z.enum(["admin", "contributor", "viewer"]) })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin"]);
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const db = await getDb();
      if (!db) {
        const inviteId = getLocalStore().nextInviteId++;
        const invite = { id: inviteId, organizationId: workspace.id, email: input.email.toLowerCase(), role: input.role, token, invitedBy: ctx.user.id, status: "pending", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdAt: new Date() };
        getLocalStore().invites.set(invite.id, invite);
        const recipient = Array.from(getLocalStore().users.values()).find(item => item.email?.toLowerCase() === input.email.toLowerCase());
        if (recipient) {
          const key = `${workspace.id}:${recipient.id}`;
          if (!getLocalStore().memberships.has(key)) getLocalStore().memberships.set(key, { organizationId: workspace.id, userId: recipient.id, role: input.role, createdAt: new Date() });
          const notificationId = getLocalStore().nextNotificationId++;
          getLocalStore().notifications.set(notificationId, { id: notificationId, organizationId: workspace.id, userId: recipient.id, type: "invite", title: "Convite para um workspace", message: `Você foi convidado para colaborar em ${workspace.name}.`, entityType: "organizationInvite", entityId: 0, readAt: null, createdAt: new Date() });
        }
        await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "invite", entityType: "organization", summary: `Convidou ${input.email} como ${input.role}` });
        return { success: true, token } as const;
      }
      await db.insert(organizationInvites).values({ organizationId: workspace.id, email: input.email.toLowerCase(), role: input.role, token, invitedBy: ctx.user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
      const recipient = (await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1))[0];
      if (recipient) {
        const existingMember = (await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, workspace.id), eq(organizationMembers.userId, recipient.id))).limit(1))[0];
        if (!existingMember) await db.insert(organizationMembers).values({ organizationId: workspace.id, userId: recipient.id, role: input.role });
        await db.insert(notifications).values({ organizationId: workspace.id, userId: recipient.id, type: "invite", title: "Convite para um workspace", message: `Você foi convidado para colaborar em ${workspace.name}.`, entityType: "organizationInvite", entityId: 0 });
      }
      await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "invite", entityType: "organization", summary: `Convidou ${input.email} como ${input.role}` });
      return { success: true, token } as const;
    }),
    acceptInvite: protectedProcedure.input(z.object({ token: z.string().min(20).max(96) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        const invitation = Array.from(getLocalStore().invites.values()).find(item => item.token === input.token && item.status === "pending");
        if (!invitation || invitation.expiresAt.getTime() < Date.now() || invitation.email.toLowerCase() !== (ctx.user.email ?? "").toLowerCase()) throw new TRPCError({ code: "BAD_REQUEST", message: "Convite inválido, expirado ou destinado a outro e-mail" });
        const key = `${invitation.organizationId}:${ctx.user.id}`;
        if (!getLocalStore().memberships.has(key)) getLocalStore().memberships.set(key, { organizationId: invitation.organizationId, userId: ctx.user.id, role: invitation.role, createdAt: new Date() });
        invitation.status = "accepted";
        await writeAuditLog({ organizationId: invitation.organizationId, actorId: ctx.user.id, action: "invite_accepted", entityType: "organization", summary: "Aceitou um convite de colaboração" });
        return { success: true, organizationId: invitation.organizationId } as const;
      }
      const invitation = (await db.select().from(organizationInvites).where(and(eq(organizationInvites.token, input.token), eq(organizationInvites.status, "pending"))).limit(1))[0];
      if (!invitation || invitation.expiresAt.getTime() < Date.now() || invitation.email.toLowerCase() !== (ctx.user.email ?? "").toLowerCase()) throw new TRPCError({ code: "BAD_REQUEST", message: "Convite inválido, expirado ou destinado a outro e-mail" });
      const existingMember = (await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, invitation.organizationId), eq(organizationMembers.userId, ctx.user.id))).limit(1))[0];
      if (!existingMember) await db.insert(organizationMembers).values({ organizationId: invitation.organizationId, userId: ctx.user.id, role: invitation.role });
      await db.update(organizationInvites).set({ status: "accepted" }).where(eq(organizationInvites.id, invitation.id));
      await writeAuditLog({ organizationId: invitation.organizationId, actorId: ctx.user.id, action: "invite_accepted", entityType: "organization", summary: "Aceitou um convite de colaboração" });
      return { success: true, organizationId: invitation.organizationId } as const;
    }),
    updateMemberRole: protectedProcedure.input(z.object({ userId: z.number().int(), role: z.enum(["admin", "contributor", "viewer"]) })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin"]);
      const db = await getDb();
      if (!db) {
        const key = `${workspace.id}:${input.userId}`;
        const target = getLocalStore().memberships.get(key);
        if (!target || target.role === "owner") throw new TRPCError({ code: "BAD_REQUEST", message: "O proprietário não pode ter o papel alterado" });
        target.role = input.role;
        await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "role_change", entityType: "organizationMember", entityId: input.userId, summary: `Alterou o papel do colaborador para ${input.role}` });
        return { success: true } as const;
      }
      const target = (await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, workspace.id), eq(organizationMembers.userId, input.userId))).limit(1))[0];
      if (!target || target.role === "owner") throw new TRPCError({ code: "BAD_REQUEST", message: "O proprietário não pode ter o papel alterado" });
      await db.update(organizationMembers).set({ role: input.role }).where(and(eq(organizationMembers.organizationId, workspace.id), eq(organizationMembers.userId, input.userId)));
      await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "role_change", entityType: "organizationMember", entityId: input.userId, summary: `Alterou o papel do colaborador para ${input.role}` });
      return { success: true } as const;
    }),
    markNotificationRead: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      const db = await getDb();
      if (!db) {
        const notification = Array.from(getLocalStore().notifications.values()).find(item => item.id === input.id && item.organizationId === workspace.id && item.userId === ctx.user.id);
        if (notification) notification.readAt = new Date();
        return { success: true } as const;
      }
      await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, input.id), eq(notifications.organizationId, workspace.id), eq(notifications.userId, ctx.user.id)));
      return { success: true } as const;
    }),
  }),

  initiatives: router({
    create: protectedProcedure.input(z.object({ name: z.string().min(3).max(180), dimension: z.enum(["Estratégica", "Normativa", "Executiva", "Ético-tecnológica"]), criterionCode: z.string().max(8).optional(), problem: z.string().max(4000).optional(), minimumProduct: z.string().max(4000).optional(), owner: z.string().max(180).optional(), dueDate: z.coerce.date().optional(), valueScore: z.number().int().min(1).max(5).optional(), riskScore: z.number().int().min(1).max(5).optional(), urgencyScore: z.number().int().min(1).max(5).optional(), feasibilityScore: z.number().int().min(1).max(5).optional(), dependencyScore: z.number().int().min(1).max(5).optional() })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin", "contributor"]);
      const complete = [input.valueScore, input.riskScore, input.urgencyScore, input.feasibilityScore, input.dependencyScore].every(value => value !== undefined);
      const priorityScore = complete ? Math.round((input.valueScore! * 0.30 + input.riskScore! * 0.25 + input.urgencyScore! * 0.20 + input.feasibilityScore! * 0.15 + input.dependencyScore! * 0.10) * 100) : null;
      const db = await getDb();
      if (!db) {
        const record = { id: getLocalStore().nextInitiativeId++, organizationId: workspace.id, assessmentId: null, ...input, status: "not_started" as const, priorityScore, createdAt: new Date(), updatedAt: new Date() };
        getLocalStore().initiatives.set(record.id, record);
        await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "create", entityType: "initiative", summary: `Criou a iniciativa ${input.name}` });
        return { success: true } as const;
      }
      await db.insert(initiatives).values({ ...input, organizationId: workspace.id, priorityScore });
      await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "create", entityType: "initiative", summary: `Criou a iniciativa ${input.name}` });
      return { success: true } as const;
    }),
    updateStatus: protectedProcedure.input(z.object({ id: z.number().int(), status: z.enum(["not_started", "in_progress", "blocked", "completed", "cancelled"]) })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin", "contributor"]);
      const db = await getDb();
      if (!db) {
        const record = getLocalStore().initiatives.get(input.id);
        if (record) record.status = input.status;
        await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "status_change", entityType: "initiative", entityId: input.id, summary: `Alterou o status da iniciativa para ${input.status}` });
        return { success: true } as const;
      }
      await db.update(initiatives).set({ status: input.status }).where(and(eq(initiatives.id, input.id), eq(initiatives.organizationId, workspace.id)));
      await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "status_change", entityType: "initiative", entityId: input.id, summary: `Alterou o status da iniciativa para ${input.status}` });
      return { success: true } as const;
    }),
  }),

  risks: router({
    create: protectedProcedure.input(z.object({ name: z.string().min(3).max(180), cause: z.string().max(4000).optional(), effect: z.string().max(4000).optional(), probability: z.number().int().min(1).max(5).optional(), impact: z.number().int().min(1).max(5).optional(), response: z.string().max(4000).optional(), owner: z.string().max(180).optional(), dueDate: z.coerce.date().optional() })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin", "contributor"]);
      const db = await getDb();
      if (!db) {
        const record = { id: getLocalStore().nextRiskId++, organizationId: workspace.id, ...input, exposure: input.probability && input.impact ? input.probability * input.impact : null, status: "open" as const, createdAt: new Date(), updatedAt: new Date() };
        getLocalStore().risks.set(record.id, record);
        await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "create", entityType: "risk", summary: `Registrou o risco ${input.name}` });
        return { success: true } as const;
      }
      await db.insert(risks).values({ ...input, organizationId: workspace.id, exposure: input.probability && input.impact ? input.probability * input.impact : null });
      await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "create", entityType: "risk", summary: `Registrou o risco ${input.name}` });
      return { success: true } as const;
    }),
  }),

  kpis: router({
    update: protectedProcedure.input(z.object({ id: z.number().int(), currentValue: z.number().int().min(0).max(100).nullable(), trend: z.enum(["improving", "stable", "declining", "no_data"]).optional(), decision: z.string().max(4000).optional() })).mutation(async ({ ctx, input }) => {
      const workspace = await ensureWorkspace(ctx.user.id, ctx.user.name);
      if (!workspace) throw new Error("Workspace indisponível");
      await requireWorkspaceRole(ctx.user.id, workspace.id, ["owner", "admin", "contributor"]);
      const db = await getDb();
      if (!db) {
        const record = getLocalStore().kpis.get(input.id);
        if (record) {
          record.currentValue = input.currentValue;
          record.trend = input.trend ?? record.trend;
          record.decision = input.decision ?? record.decision;
          record.measuredAt = new Date();
          record.updatedAt = new Date();
        }
        await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "update", entityType: "kpi", entityId: input.id, summary: "Atualizou um indicador", metadata: { currentValue: input.currentValue, trend: input.trend } });
        return { success: true } as const;
      }
      await db.update(kpis).set({ currentValue: input.currentValue, trend: input.trend, decision: input.decision, measuredAt: new Date() }).where(and(eq(kpis.id, input.id), eq(kpis.organizationId, workspace.id)));
      await writeAuditLog({ organizationId: workspace.id, actorId: ctx.user.id, action: "update", entityType: "kpi", entityId: input.id, summary: "Atualizou um indicador", metadata: { currentValue: input.currentValue, trend: input.trend } });
      return { success: true } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
