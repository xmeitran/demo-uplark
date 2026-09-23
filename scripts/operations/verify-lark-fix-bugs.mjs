import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';

// Requires the private test environment explicitly; never reads the repository .env.
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
  && /(?:^|_)test(?:_|$)/.test(database.pathname.slice(1)), 'Isolated loopback test database required');
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module.js');
const { configureAppSecurity } = require('./dist/bootstrap-security.js');
const { hashPassword } = require('./dist/modules/identity-access/auth-security.service.js');
const prisma = new PrismaClient();
const run = `fix65-${randomUUID()}`;
const workspaceIds = [], userIds = [];
const password = `Test-only-${randomBytes(18).toString('base64url')}`;
let app, base, passed = 0;
async function request(path, { method = 'GET', token, body, key } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
function ok(r) { assert(r.status >= 200 && r.status < 300, `HTTP ${r.status}: ${JSON.stringify(r.body)}`); return r.body; }
function denied(r, status) { if (status) assert.equal(r.status, status, JSON.stringify(r.body)); else assert(r.status >= 400 && r.status < 500, `Expected 4xx, got ${r.status}`); }
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
try {
  Object.assign(process.env, { NODE_ENV: 'test', FOUNDATION_TENANT_KEY: run, FOUNDATION_WORKSPACE_KEY: 'default', CRM_LOCAL_AUTH_ENABLED: 'true', CRM_ENABLE_DEMO_SESSION: 'false', CRM_ENABLE_DIRECT_LARK_SESSION: 'false', CRM_ALLOW_PRINCIPAL_FALLBACK: 'false', CRM_PUBLIC_SESSION_REQUIRED: '1' });
  const workspace = await prisma.tenantWorkspace.create({ data: { tenantKey: run, workspaceKey: 'default', name: run } });
  workspaceIds.push(workspace.id);
  const foreign = await prisma.tenantWorkspace.create({ data: { tenantKey: `${run}-foreign`, workspaceKey: 'default', name: `${run} foreign` } });
  workspaceIds.push(foreign.id); process.env.FOUNDATION_WORKSPACE_ID = workspace.id;
  const roles = {};
  for (const code of ['FOUNDER_GM', 'DELIVERY_LEAD', 'SALES_OWNER']) roles[code] = await prisma.role.upsert({ where: { code }, update: {}, create: { code, name: code, type: 'BUSINESS' } });
  const passwordHash = await hashPassword(password);
  async function user(suffix, code = 'SALES_OWNER', target = workspace, extra = {}) {
    const value = await prisma.user.create({ data: { email: `${run}-${suffix}@example.test`, displayName: suffix.startsWith('member') ? 'Same Name' : suffix, passwordHash, emailVerifiedAt: new Date(), ...extra,
      roleBindings: { create: { roleId: roles[code].id, tenantKey: target.tenantKey, workspaceId: target.id } } } });
    userIds.push(value.id); return value;
  }
  const founder = await user('founder', 'FOUNDER_GM');
  const lead = await user('lead', 'DELIVERY_LEAD');
  const memberA = await user('member-a'), memberB = await user('member-b');
  const nonmember = await user('nonmember');
  const inactive = await user('inactive', 'SALES_OWNER', workspace, { status: 'SUSPENDED' });
  const future = await user('future');
  await prisma.roleBinding.updateMany({ where: { userId: future.id }, data: { startsAt: new Date('2099-01-01') } });
  const expired = await user('expired');
  await prisma.roleBinding.updateMany({ where: { userId: expired.id }, data: { endsAt: new Date('2020-01-01') } });
  const outsider = await user('outsider', 'FOUNDER_GM', foreign);
  const account = await prisma.account.create({ data: { workspaceId: workspace.id, code: `${run}-account`, name: 'Same Client', stage: 'active' } });
  const foreignAccount = await prisma.account.create({ data: { workspaceId: foreign.id, code: `${run}-foreign`, name: 'Same Client', stage: 'active' } });
  await prisma.account.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ workspaceId: workspace.id, code: `${run}-${i}`, name: i === 100 ? 'Late Client' : 'Same Client', stage: 'active' })) });
  app = await NestFactory.create(AppModule, { logger: ['error'] }); app.setGlobalPrefix('api'); configureAppSecurity(app); await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api`;
  async function login(u, w = workspace) { return ok(await request('/auth/password/login', { method: 'POST', body: { email: u.email, password, workspaceId: w.id } })).token; }
  const founderToken = await login(founder), leadToken = await login(lead), tokenA = await login(memberA), tokenB = await login(memberB), nonmemberToken = await login(nonmember), outsiderToken = await login(outsider, foreign);
  let project, task, entry;
  const members = [founder.id, lead.id, memberA.id, memberB.id];
  const createInput = { accountId: account.id, name: 'Concurrent project', ownerUserId: founder.id, memberUserIds: [lead.id, memberA.id, memberB.id], createStageTemplate: false };
  await check('EV-008 concurrent HTTP retries create exactly one project and receipt', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => request('/projects', { method: 'POST', token: founderToken, key: 'same-create-intent', body: createInput })));
    const values = results.map(ok); project = values[0]; assert(project.id); assert(values.every(v => v.id === project.id));
    assert.equal(await prisma.project.count({ where: { workspaceId: workspace.id } }), 1);
    assert.equal(await prisma.projectCreateReceipt.count({ where: { workspaceId: workspace.id } }), 1);
    denied(await request('/projects', { method: 'POST', token: founderToken, key: 'same-create-intent', body: { ...createInput, name: 'Changed intent' } }), 409);
  });
  await check('EV-008 rejects missing authentication and foreign client without partial records', async () => {
    denied(await request('/projects', { method: 'POST', body: createInput }), 401);
    denied(await request('/projects', { method: 'POST', token: founderToken, body: { ...createInput, accountId: foreignAccount.id } }));
    assert.equal(await prisma.project.count({ where: { workspaceId: workspace.id } }), 1);
  });
  await check('EV-009 paginated and searched clients remain workspace scoped and preserve IDs', async () => {
    const first = ok(await request('/accounts?limit=100&offset=0', { token: founderToken }));
    const second = ok(await request('/accounts?limit=100&offset=100', { token: founderToken }));
    assert.equal(first.data.length, 100); assert.equal(second.data.length, 2);
    const all = [...first.data, ...second.data]; assert.equal(new Set(all.map(v => v.id)).size, 102); assert(!all.some(v => v.id === foreignAccount.id));
    const search = ok(await request('/accounts?q=Late%20Client', { token: founderToken })); assert.equal(search.data.length, 1);
  });
  await check('EV-011/017 actual members exclude suspended, future, expired and foreign grants', async () => {
    await prisma.projectMember.createMany({ data: [inactive, future, expired, outsider].map(u => ({ workspaceId: workspace.id, projectId: project.id, userId: u.id, relation: 'legacy' })) });
    const response = ok(await request(`/projects/${project.id}/members?limit=2&offset=0`, { token: founderToken }));
    const next = ok(await request(`/projects/${project.id}/members?limit=2&offset=2`, { token: founderToken }));
    const ids = [...response.data, ...next.data].map(v => v.userId ?? v.id);
    assert.deepEqual(ids.sort(), [...members].sort());
    denied(await request(`/projects/${project.id}/members`, { token: outsiderToken }));
  });
  await check('EV-011 unauthorized team mutations are rejected and manager changes persist with audit', async () => {
    denied(await request(`/projects/${project.id}`, { method: 'PATCH', token: tokenA, body: { memberUserIds: [...members, nonmember.id] } }), 403);
    ok(await request(`/projects/${project.id}`, { method: 'PATCH', token: leadToken, body: { memberUserIds: [...members, nonmember.id] } }));
    await prisma.projectMember.create({ data: { workspaceId: workspace.id, projectId: project.id, userId: nonmember.id, relation: 'legacy' } });
    ok(await request(`/projects/${project.id}`, { method: 'PATCH', token: founderToken, body: { memberUserIds: members } }));
    assert.equal(await prisma.projectMember.count({ where: { projectId: project.id, userId: nonmember.id } }), 0);
    assert(await prisma.auditEvent.count({ where: { workspaceId: workspace.id, resourceId: project.id, actorUserId: founder.id } }) > 0);
  });
  const milestone = await prisma.projectMilestone.create({ data: { workspaceId: workspace.id, accountId: account.id, projectId: project.id, name: 'Unassigned milestone', normalizedKey: 'unassigned milestone', sortOrder: 0 } });
  const stage = await prisma.projectStage.create({ data: { workspaceId: workspace.id, accountId: account.id, projectId: project.id, milestoneId: milestone.id, phase: 'Unassigned milestone', activity: 'First activity', sortOrder: 0, stageKey: 'test-stage', cumulativePercent: 0, activityPercent: 0, criteria: 'Test criteria' } });
  await check('EV-016 milestone name-only save persists without PIC; blank and unauthorized changes fail', async () => {
    const path = `/projects/${project.id}/stages/${stage.id}?scope=milestone`;
    ok(await request(path, { method: 'PATCH', token: founderToken, body: { phase: '  Triển khai & nghiệm thu  ' } }));
    const stored = await prisma.projectStage.findUniqueOrThrow({ where: { id: stage.id } }); assert.equal(stored.phase, 'Triển khai & nghiệm thu'); assert.equal(stored.ownerUserId, null); assert.equal((await prisma.projectMilestone.findUniqueOrThrow({ where: { id: milestone.id } })).name, 'Triển khai & nghiệm thu');
    denied(await request(path, { method: 'PATCH', token: founderToken, body: { phase: '  ' } }), 400);
    denied(await request(path, { method: 'PATCH', token: tokenA, body: { phase: 'Unauthorized' } }), 403);
  });
  await check('EV-017 PIC assignment uses project member ID and rejects inactive/outsider', async () => {
    const path = `/projects/${project.id}/stages/${stage.id}`;
    for (const u of [inactive, outsider, nonmember]) denied(await request(path, { method: 'PATCH', token: founderToken, body: { ownerUserId: u.id } }));
    ok(await request(path, { method: 'PATCH', token: founderToken, body: { ownerUserId: memberB.id } }));
    assert.equal((await prisma.projectStage.findUniqueOrThrow({ where: { id: stage.id } })).ownerUserId, memberB.id);
  });
  await prisma.projectStage.update({ where: { id: stage.id }, data: { ownerUserId: founder.id } });
  task = await prisma.projectTask.create({ data: { workspaceId: workspace.id, accountId: account.id, projectId: project.id, title: 'Transfer regression', status: 'todo', assigneeUserId: memberA.id, plannedStartAt: new Date('2026-09-05T18:00:00.000Z') } });
  await check('EV-018 self/on-behalf permissions and active project performer enforced', async () => {
    const path = `/tasks/${task.id}/time-entries`, body = { minutes: 30, workDate: '2026-09-06', timeZone: 'Asia/Ho_Chi_Minh' };
    denied(await request(path, { method: 'POST', token: tokenA, body: { ...body, userId: memberB.id } }), 403);
    denied(await request(path, { method: 'POST', token: nonmemberToken, body: { ...body, userId: nonmember.id } }));
    for (const u of [nonmember, inactive, outsider]) denied(await request(path, { method: 'POST', token: founderToken, body: { ...body, userId: u.id } }));
    ok(await request(path, { method: 'POST', token: tokenA, body: { ...body, userId: memberA.id } }));
    entry = ok(await request(path, { method: 'POST', token: founderToken, body: { ...body, userId: memberB.id } }));
    const stored = await prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: entry.id } }); assert.equal(stored.userId, memberB.id);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId: workspace.id, resourceId: entry.id, actorUserId: founder.id } }); assert.equal(audit.after.performerUserId, memberB.id);
  });
  await check('EV-020 current task PIC can transfer; unauthorized member cannot; historic performer preserved', async () => {
    denied(await request(`/tasks/${task.id}`, { method: 'PATCH', token: tokenB, body: { assigneeUserId: memberB.id } }), 403);
    ok(await request(`/tasks/${task.id}`, { method: 'PATCH', token: tokenA, body: { assigneeUserId: memberB.id } }));
    assert.equal((await prisma.projectTask.findUniqueOrThrow({ where: { id: task.id } })).assigneeUserId, memberB.id);
    assert.equal((await prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: entry.id } })).userId, memberB.id);
    const oldSelf = await prisma.taskTimeEntry.findFirstOrThrow({ where: { taskId: task.id, userId: memberA.id } }); assert.equal(oldSelf.userId, memberA.id);
    const history = ok(await request(`/tasks/${task.id}/assignment-history`, { token: founderToken })); assert(history.data.length >= 1);
    assert(await prisma.auditEvent.count({ where: { resourceId: task.id, action: 'task.assignee_transferred', actorUserId: memberA.id } }) > 0);
  });
  await check('EV-011 assigned member removal requires transfer first', async () => {
    denied(await request(`/projects/${project.id}`, { method: 'PATCH', token: founderToken, body: { memberUserIds: members.filter(id => id !== memberB.id) } }));
    assert(await prisma.projectMember.count({ where: { projectId: project.id, userId: memberB.id } }) > 0);
  });
  await check('EV-024 selected Vietnam work date persists at UTC date boundary', async () => {
    const value = ok(await request(`/tasks/${task.id}/time-entries`, { method: 'POST', token: tokenB, body: { userId: memberB.id, minutes: 60, workDate: '2026-09-07', startAt: '2026-09-06T18:00:00.000Z', endAt: '2026-09-06T19:00:00.000Z', timeZone: 'Asia/Ho_Chi_Minh' } }));
    const stored = await prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: value.id } });
    assert.equal(stored.workDate.toISOString(), '2026-09-06T18:00:00.000Z'); assert.equal(stored.timeZone, 'Asia/Ho_Chi_Minh'); assert.equal(value.dailyActualLog.localDate, '2026-09-07');
  });
  await check('EV-020 upstream task relocation restriction remains enforced for assignee and Founder', async () => {
    const destination = ok(await request('/projects', { method: 'POST', token: founderToken, key: 'destination', body: { accountId: account.id, name: 'Destination', createStageTemplate: false } }));
    denied(await request(`/tasks/${task.id}`, { method: 'PATCH', token: tokenB, body: { projectId: destination.id } }), 400);
    denied(await request(`/tasks/${task.id}`, { method: 'PATCH', token: founderToken, body: { projectId: destination.id } }));
    assert.equal((await prisma.projectTask.findUniqueOrThrow({ where: { id: task.id } })).projectId, project.id);
    ok(await request(`/projects/${destination.id}`, { method: 'PATCH', token: founderToken, body: { memberUserIds: [founder.id, memberB.id] } }));
    denied(await request(`/tasks/${task.id}`, { method: 'PATCH', token: founderToken, body: { projectId: destination.id } }), 400);
    assert.equal((await prisma.projectTask.findUniqueOrThrow({ where: { id: task.id } })).projectId, project.id);
    assert.equal((await prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: entry.id } })).userId, memberB.id);
  });
  await check('EV-018 existing standalone tasks retain workspace-scoped self logging', async () => {
    const standalone = await prisma.projectTask.create({ data: { workspaceId: workspace.id, accountId: account.id, title: 'Standalone task', status: 'todo', assigneeUserId: nonmember.id } });
    const value = ok(await request(`/tasks/${standalone.id}/time-entries`, { method: 'POST', token: nonmemberToken, body: { userId: nonmember.id, minutes: 30, workDate: '2026-09-06' } }));
    assert.equal(value.userId, nonmember.id); assert.equal((await prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: value.id } })).projectId, null);
  });
  console.log(`Lark Fix Bug HTTP + PostgreSQL integration: ${passed} scenarios passed.`);
} finally {
  if (app) await app.close();
  const where = { workspaceId: { in: workspaceIds } };
  for (const model of ['auditEvent', 'projectCreateReceipt', 'projectActivity', 'taskTimeEntry', 'taskStatusHistory', 'taskPlanningBlock', 'projectTask', 'projectStage', 'projectMember', 'project', 'account', 'portalSession', 'roleBinding']) await prisma[model].deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenantWorkspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.$disconnect();
  console.log('Removed isolated verification records.');
}
