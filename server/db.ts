import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, assessmentResponses, assessments, auditLogs, initiatives, kpis, notifications, organizationInvites, organizationMembers, organizations, risks, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

const localStore = {
  nextUserId: 1,
  nextWorkspaceId: 1,
  nextAssessmentId: 1,
  nextResponseId: 1,
  nextInitiativeId: 1,
  nextRiskId: 1,
  nextKpiId: 1,
  nextNotificationId: 1,
  nextAuditId: 1,
  nextInviteId: 1,
  users: new Map<string, any>(),
  organizations: new Map<number, any>(),
  memberships: new Map<string, any>(),
  assessments: new Map<number, any>(),
  responses: new Map<number, any>(),
  initiatives: new Map<number, any>(),
  risks: new Map<number, any>(),
  kpis: new Map<number, any>(),
  notifications: new Map<number, any>(),
  auditLogs: new Map<number, any>(),
  invites: new Map<number, any>(),
};

function ensureLocalUserRecord(user: any) {
  const key = user.openId || `${user.email || "local-user"}:${user.id ?? "0"}`;
  const existing = localStore.users.get(key) ?? localStore.users.get(user.openId);
  if (existing) {
    const merged = { ...existing, ...user, openId: existing.openId || user.openId };
    localStore.users.set(merged.openId, merged);
    return merged;
  }

  const record = {
    id: user.id ?? localStore.nextUserId++,
    openId: user.openId,
    name: user.name ?? "Usuário local",
    email: user.email ?? null,
    loginMethod: user.loginMethod ?? "local",
    role: user.role ?? "user",
    createdAt: new Date(user.createdAt ?? Date.now()),
    updatedAt: new Date(user.updatedAt ?? Date.now()),
    lastSignedIn: new Date(user.lastSignedIn ?? Date.now()),
  };

  localStore.users.set(record.openId, record);
  return record;
}

function ensureLocalMembership(userId: number, organizationId: number, role: "owner" | "admin" | "contributor" | "viewer" = "owner") {
  const key = `${organizationId}:${userId}`;
  const existing = localStore.memberships.get(key);
  if (existing) return existing;

  const membership = { organizationId, userId, role, createdAt: new Date() };
  localStore.memberships.set(key, membership);
  return membership;
}

function createLocalAssessment(organizationId: number, createdBy: number) {
  const assessment = {
    id: localStore.nextAssessmentId++,
    organizationId,
    title: "Diagnóstico inicial F-GEA",
    status: "active",
    createdBy,
    assessedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  localStore.assessments.set(assessment.id, assessment);
  return assessment;
}

function createLocalResponsesForAssessment(assessmentId: number, organizationId: number) {
  const existing = Array.from(localStore.responses.values()).filter(item => item.assessmentId === assessmentId);
  if (existing.length > 0) return existing;

  const seeded = CRITERIA.map(([code, dimension, criterion, evidenceExpected], index) => ({
    id: localStore.nextResponseId++,
    assessmentId,
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

  for (const row of seeded) localStore.responses.set(row.id, row);
  return seeded;
}

export function getLocalStore() {
  return localStore;
}

export async function getLocalWorkspaceOverview(user: { id: number; name?: string | null; email?: string | null; openId?: string }) {
  const safeUserId = Number.isFinite(user.id) ? user.id : 0;
  const safeUserName = user.name || "Usuário local";
  const openId = user.openId || `local:${user.email || safeUserName}`;
  ensureLocalUserRecord({
    id: safeUserId,
    openId,
    name: safeUserName,
    email: user.email ?? null,
    loginMethod: "local",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  });

  let workspace = Array.from(localStore.organizations.values()).find(item => item.ownerId === safeUserId);
  if (!workspace) {
    workspace = {
      id: localStore.nextWorkspaceId++,
      name: `${safeUserName}'s workspace`,
      acronym: "F-GEA",
      description: null,
      ownerId: safeUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    localStore.organizations.set(workspace.id, workspace);
  }

  ensureLocalMembership(safeUserId, workspace.id, "owner");

  let assessment = Array.from(localStore.assessments.values()).filter(item => item.organizationId === workspace.id).sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!assessment) {
    assessment = createLocalAssessment(workspace.id, safeUserId);
  }

  const responses = Array.from(localStore.responses.values()).filter(item => item.assessmentId === assessment.id).sort((a, b) => Number(a.id) - Number(b.id));
  if (!responses.length) {
    const seeded = createLocalResponsesForAssessment(assessment.id, workspace.id);
    seeded.forEach(item => localStore.responses.set(item.id, item));
  }

  const snapshot = {
    initiatives: Array.from(localStore.initiatives.values()).filter(item => item.organizationId === workspace.id).sort((a, b) => Number(b.updatedAt?.getTime?.() ?? 0) - Number(a.updatedAt?.getTime?.() ?? 0)),
    kpis: Array.from(localStore.kpis.values()).filter(item => item.organizationId === workspace.id).sort((a, b) => String(a.code).localeCompare(String(b.code))),
    risks: Array.from(localStore.risks.values()).filter(item => item.organizationId === workspace.id).sort((a, b) => Number(b.exposure ?? 0) - Number(a.exposure ?? 0)),
  };

  if (!snapshot.initiatives.length) {
    const seededInitiatives = [
      { id: localStore.nextInitiativeId++, organizationId: workspace.id, assessmentId: assessment.id, name: "Mapear ativos arquivísticos críticos", dimension: "Estratégica", criterionCode: "E2", problem: "Falta visão da realidade documental de missão.", minimumProduct: "Mapa de ativos e responsáveis.", owner: safeUserName, valueScore: 4, riskScore: 3, urgencyScore: 4, feasibilityScore: 4, dependencyScore: 3, priorityScore: 88, status: "in_progress", dueDate: new Date(Date.now() + 86400000 * 12), createdAt: new Date(), updatedAt: new Date() },
      { id: localStore.nextInitiativeId++, organizationId: workspace.id, assessmentId: assessment.id, name: "Padronizar controles de acesso e preservação", dimension: "Normativa", criterionCode: "N2", problem: "Há regras dispersas e sem rastreio claro.", minimumProduct: "Catalogação de controles, papéis e evidências.", owner: safeUserName, valueScore: 5, riskScore: 4, urgencyScore: 5, feasibilityScore: 3, dependencyScore: 3, priorityScore: 92, status: "not_started", dueDate: new Date(Date.now() + 86400000 * 18), createdAt: new Date(), updatedAt: new Date() },
    ];
    for (const item of seededInitiatives) localStore.initiatives.set(item.id, item);
    snapshot.initiatives.push(...seededInitiatives);
  }

  if (!snapshot.kpis.length) {
    const seededKpis = [
      { id: localStore.nextKpiId++, organizationId: workspace.id, code: "KPI-01", name: "Taxa de respostas do diagnóstico", definition: "Percentual de critérios avaliados.", currentValue: 36, targetValue: 100, unit: "%", trend: "improving", decisionTrigger: "Quando atingir menos de 70% do diagnóstico respondido.", decision: "Priorizar revisão do diagnóstico em ciclo de governança.", measuredAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
      { id: localStore.nextKpiId++, organizationId: workspace.id, code: "KPI-02", name: "Iniciativas em execução", definition: "Número de iniciativas com status em andamento.", currentValue: 1, targetValue: 5, unit: "itens", trend: "stable", decisionTrigger: "Menos de 2 iniciativas ativas.", decision: "Reagendar priorização e apoio executivo.", measuredAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
      { id: localStore.nextKpiId++, organizationId: workspace.id, code: "KPI-03", name: "Riscos com resposta definida", definition: "Riscos com plano de resposta documentado.", currentValue: 0, targetValue: 100, unit: "%", trend: "declining", decisionTrigger: "Se a taxa cair abaixo de 50%.", decision: "Conduzir reunião de tratamento e acompanhamento.", measuredAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
    ];
    for (const item of seededKpis) localStore.kpis.set(item.id, item);
    snapshot.kpis.push(...seededKpis);
  }

  if (!snapshot.risks.length) {
    const seededRisks = [
      { id: localStore.nextRiskId++, organizationId: workspace.id, name: "Risco de perda de evidência documental", cause: "Falta de padronização nos registros e preservação.", effect: "Compromete a rastreabilidade e a decisão do órgão.", probability: 3, impact: 4, exposure: 12, response: "Definir política de retenção e revisão de evidências.", owner: safeUserName, status: "open", dueDate: new Date(Date.now() + 86400000 * 20), createdAt: new Date(), updatedAt: new Date() },
    ];
    for (const item of seededRisks) localStore.risks.set(item.id, item);
    snapshot.risks.push(...seededRisks);
  }

  const members = Array.from(localStore.memberships.values()).filter(item => item.organizationId === workspace.id).map(membership => {
    const user = localStore.users.get(Array.from(localStore.users.values()).find(entry => Number(entry.id) === Number(membership.userId))?.openId ?? "") || Array.from(localStore.users.values()).find(entry => Number(entry.id) === Number(membership.userId));
    return { user: user ?? { id: membership.userId, name: safeUserName, email: user?.email ?? null }, membership };
  });

  const notifications = Array.from(localStore.notifications.values()).filter(item => item.organizationId === workspace.id && item.userId === safeUserId).sort((a, b) => Number(b.createdAt?.getTime?.() ?? 0) - Number(a.createdAt?.getTime?.() ?? 0));
  const audit = Array.from(localStore.auditLogs.values()).filter(item => item.organizationId === workspace.id).sort((a, b) => Number(b.createdAt?.getTime?.() ?? 0) - Number(a.createdAt?.getTime?.() ?? 0)).slice(0, 20);

  const dimensions = ["Estratégica", "Normativa", "Executiva", "Ético-tecnológica"].map(name => {
    const items = responses.filter(item => item.dimension === name);
    const answered = items.filter(item => item.score !== null);
    const average = answered.length ? answered.reduce((total, item) => total + (item.score ?? 0), 0) / answered.length : 0;
    return { name, average: Number((Math.round(average * 10) / 10).toFixed(1)), answered: answered.length, total: items.length };
  });

  const answered = responses.filter(item => item.score !== null).length;
  const criticalGaps = responses.filter(item => ["N2", "N4", "T2", "T4"].includes(item.code) && (item.score === null || item.score < 3));

  return { workspace, assessment, responses, dimensions, snapshot, members, audit, notifications, currentRole: members.find(item => Number(item.user.id) === Number(safeUserId))?.membership.role ?? "owner", progress: { answered, total: responses.length, percentage: responses.length ? Math.round((answered / responses.length) * 100) : 0, criticalGaps: criticalGaps.length } };
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export function getLocalMembershipRole(organizationId: number, userId: number) {
  return localStore.memberships.get(`${organizationId}:${userId}`)?.role as "owner" | "admin" | "contributor" | "viewer" | undefined;
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    const result = Array.from(localStore.users.values()).find(user => user.openId === openId);
    return result ?? undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export const DIMENSIONS = ["Estratégica", "Normativa", "Executiva", "Ético-tecnológica"] as const;

export const CRITERIA = [
  ["E1", "Estratégica", "Objetivos arquivísticos vinculados ao planejamento institucional.", "PPA, PEI, PDTI/PDTIC ou mapa estratégico com vínculo explícito."],
  ["E2", "Estratégica", "Patrocínio executivo e instância formal de decisão.", "Ato de criação, regimento, atas e decisões."],
  ["E3", "Estratégica", "Política arquivística define valor, escopo, responsabilidades e prioridades.", "Política aprovada e divulgada."],
  ["E4", "Estratégica", "Benefícios e riscos arquivísticos entram nas decisões de investimento.", "Business case, análise de riscos ou critérios de priorização."],
  ["E5", "Estratégica", "Desempenho arquivístico é reportado à governança.", "Painel, relatório e decisões decorrentes."],
  ["N1", "Normativa", "Instrumentos de gestão de documentos aplicáveis aos processos prioritários.", "Classificação, temporalidade, destinação e procedimentos."],
  ["N2", "Normativa", "Autenticidade, confiabilidade, integridade e usabilidade definidas.", "Requisitos, metadados, trilhas e controles."],
  ["N3", "Normativa", "Acesso, sigilo, proteção de dados e transparência articulados.", "Matriz de acesso, bases legais e regras."],
  ["N4", "Normativa", "Preservação digital e cadeia de custódia com controles.", "Plano, repositório, checksums, logs e procedimentos."],
  ["N5", "Normativa", "Conformidade verificada e desvios tratados.", "Auditorias, não conformidades e planos corretivos."],
  ["X1", "Executiva", "Backlog priorizado de iniciativas arquivísticas.", "Backlog com valor, prioridade, dependências e aceite."],
  ["X2", "Executiva", "Projetos usam planejamento proporcional e abordagem híbrida.", "Termo de abertura, roadmap, sprints/fluxo e decisões."],
  ["X3", "Executiva", "Critérios de pronto e aceite para entregas.", "Definition of Ready/Done, testes e aceite."],
  ["X4", "Executiva", "Capacidade, custos, riscos e impedimentos acompanhados.", "Capacidade, riscos e métricas de fluxo."],
  ["X5", "Executiva", "Entregas adotadas e sustentadas após o projeto.", "Mudança, treinamento, uso e transferência para operação."],
  ["T1", "Ético-tecnológica", "Inventário de sistemas, automações e usos de IA em documentos.", "Catálogo, proprietários e finalidade."],
  ["T2", "Ético-tecnológica", "Sistemas críticos com avaliação de risco arquivístico e segurança.", "Avaliação de impacto ou threat model."],
  ["T3", "Ético-tecnológica", "Decisões automatizadas com supervisão e explicabilidade.", "Documentação, revisão humana e contestação."],
  ["T4", "Ético-tecnológica", "Trilhas de auditoria e controles sobre dados, modelos e resultados.", "Logs, versionamento, amostras e métricas de erro."],
  ["T5", "Ético-tecnológica", "IA e tecnologias emergentes aprovadas, monitoradas e reavaliadas.", "Critérios de uso, auditoria e descontinuação."],
] as const;

export async function getWorkspace(userId: number) {
  const db = await getDb();
  if (!db) {
    const memberships = Array.from(localStore.memberships.values()).filter(item => item.userId === userId);
    if (!memberships.length) return undefined;
    const organizationId = memberships[0].organizationId;
    return localStore.organizations.get(organizationId) ?? undefined;
  }

  const memberships = await db.select({ organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(desc(organizations.updatedAt));
  return memberships[0]?.organization;
}

export async function ensureWorkspace(userId: number, userName?: string | null) {
  const db = await getDb();
  if (!db) {
    let existing = Array.from(localStore.organizations.values()).find(org => org.ownerId === userId);
    if (!existing) {
      const workspace = {
        id: localStore.nextWorkspaceId++,
        name: userName ? `Workspace de ${userName}` : "Minha organização",
        acronym: "F-GEA",
        description: null,
        ownerId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      localStore.organizations.set(workspace.id, workspace);
      ensureLocalMembership(userId, workspace.id, "owner");
      existing = workspace;
    }
    return existing;
  }

  const existing = await getWorkspace(userId);
  if (existing) return existing;
  await db.insert(organizations).values({ name: userName ? `Workspace de ${userName}` : "Minha organização", acronym: "F-GEA", ownerId: userId });
  const created = await db.select().from(organizations).where(eq(organizations.ownerId, userId)).orderBy(desc(organizations.id)).limit(1);
  if (!created[0]) return undefined;
  await db.insert(organizationMembers).values({ organizationId: created[0].id, userId, role: "owner" });
  return created[0];
}

export async function getAssessmentData(organizationId: number) {
  const db = await getDb();
  if (!db) {
    const assessmentsForOrg = Array.from(localStore.assessments.values()).filter(item => item.organizationId === organizationId).sort((a, b) => Number(b.id) - Number(a.id));
    const assessment = assessmentsForOrg[0] ?? createLocalAssessment(organizationId, 0);
    const responses = Array.from(localStore.responses.values()).filter(item => item.assessmentId === assessment.id).sort((a, b) => Number(a.id) - Number(b.id));
    if (!responses.length) {
      const seeded = createLocalResponsesForAssessment(assessment.id, organizationId);
      seeded.forEach(item => localStore.responses.set(item.id, item));
    }
    return { assessment, responses: Array.from(localStore.responses.values()).filter(item => item.assessmentId === assessment.id).sort((a, b) => Number(a.id) - Number(b.id)) };
  }

  const assessmentRows = await db.select().from(assessments).where(eq(assessments.organizationId, organizationId)).orderBy(desc(assessments.updatedAt)).limit(1);
  const assessment = assessmentRows[0];
  const responses = assessment ? await db.select().from(assessmentResponses).where(eq(assessmentResponses.assessmentId, assessment.id)).orderBy(assessmentResponses.id) : [];
  return { assessment, responses };
}

export async function getWorkspaceSnapshot(organizationId: number) {
  const db = await getDb();
  if (!db) {
    const snapshot = {
      initiatives: Array.from(localStore.initiatives.values()).filter(item => item.organizationId === organizationId).sort((a, b) => Number(b.updatedAt?.getTime?.() ?? 0) - Number(a.updatedAt?.getTime?.() ?? 0)),
      kpis: Array.from(localStore.kpis.values()).filter(item => item.organizationId === organizationId).sort((a, b) => String(a.code).localeCompare(String(b.code))),
      risks: Array.from(localStore.risks.values()).filter(item => item.organizationId === organizationId).sort((a, b) => Number(b.exposure ?? 0) - Number(a.exposure ?? 0)),
    };
    return snapshot;
  }

  const [initiativeRows, kpiRows, riskRows] = await Promise.all([
    db.select().from(initiatives).where(eq(initiatives.organizationId, organizationId)).orderBy(desc(initiatives.updatedAt)),
    db.select().from(kpis).where(eq(kpis.organizationId, organizationId)).orderBy(kpis.code),
    db.select().from(risks).where(and(eq(risks.organizationId, organizationId), eq(risks.status, "open"))).orderBy(desc(risks.exposure)),
  ]);
  return { initiatives: initiativeRows, kpis: kpiRows, risks: riskRows };
}

export async function getWorkspaceMembers(organizationId: number) {
  const db = await getDb();
  if (!db) {
    return Array.from(localStore.memberships.values()).filter(item => item.organizationId === organizationId).map(membership => {
      const user = Array.from(localStore.users.values()).find(entry => Number(entry.id) === Number(membership.userId));
      return { user: user ?? { id: membership.userId, name: "Usuário local", email: null }, membership };
    });
  }

  return db.select({ user: users, membership: organizationMembers }).from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId));
}

export async function writeAuditLog(input: { organizationId: number; actorId: number; action: string; entityType: string; entityId?: number; summary: string; metadata?: unknown }) {
  const db = await getDb();
  if (!db) {
    const record = {
      id: localStore.nextAuditId++,
      ...input,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date(),
    };
    localStore.auditLogs.set(record.id, record);
    return;
  }

  await db.insert(auditLogs).values({ ...input, metadata: input.metadata ? JSON.stringify(input.metadata) : null });
}

export async function getWorkspaceAudit(organizationId: number) {
  const db = await getDb();
  if (!db) {
    return Array.from(localStore.auditLogs.values()).filter(item => item.organizationId === organizationId).sort((a, b) => Number(b.createdAt?.getTime?.() ?? 0) - Number(a.createdAt?.getTime?.() ?? 0)).slice(0, 50).map(audit => ({
      audit: { ...audit, metadata: audit.metadata ?? null, createdAt: audit.createdAt },
      actor: Array.from(localStore.users.values()).find(user => Number(user.id) === Number(audit.actorId)) ?? { id: audit.actorId, name: "Usuário local", email: null },
    }));
  }

  return db.select({ audit: auditLogs, actor: users }).from(auditLogs).innerJoin(users, eq(auditLogs.actorId, users.id)).where(eq(auditLogs.organizationId, organizationId)).orderBy(desc(auditLogs.createdAt)).limit(50);
}

export async function getUserNotifications(organizationId: number, userId: number) {
  const db = await getDb();
  if (!db) {
    return Array.from(localStore.notifications.values()).filter(item => item.organizationId === organizationId && item.userId === userId).sort((a, b) => Number(b.createdAt?.getTime?.() ?? 0) - Number(a.createdAt?.getTime?.() ?? 0)).slice(0, 30);
  }

  return db.select().from(notifications).where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId))).orderBy(desc(notifications.createdAt)).limit(30);
}
