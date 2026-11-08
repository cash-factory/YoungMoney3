#!/usr/bin/env node
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  YM_FX_ENTRY_MODELS,
  YM_FX_PLAN,
  YM_FX_PLAN_CHECKS,
  YM_FX_PLAN_RULES,
  YM_FX_STRATEGY_NAME,
  YM_20_ENTRY_MODELS,
  YM_20_PLAN,
  YM_20_PLAN_CHECKS,
  YM_20_PLAN_RULES,
  YM_20_PLAN_TITLE,
  YM_20_STRATEGY_NAME,
} from '../src/data/ymFxPlanTemplate.ts';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 8) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) in the environment.');
}

const userId = stableId(`owner:${email}`);
const timestamp = new Date().toISOString();
const encoder = new TextEncoder();
const salt = randomBytes(16).toString('base64');
const passwordKey = await webcrypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
const passwordBits = await webcrypto.subtle.deriveBits(
  { name: 'PBKDF2', salt: Buffer.from(salt, 'base64'), iterations: 100000, hash: 'SHA-256' },
  passwordKey,
  256,
);
const passwordHash = Buffer.from(passwordBits).toString('base64');

const statements = [
  `INSERT INTO users (id,email,username,display_name,password_hash,password_salt,role,account_status,created_at,updated_at)
   VALUES (${sql(userId)},${sql(email)},'young_money','young_money',${sql(passwordHash)},${sql(salt)},'admin','active',${sql(timestamp)},${sql(timestamp)})
   ON CONFLICT(id) DO NOTHING;`,
];

seedPlaybook({
  key: 'Young-Money-Fx',
  strategyName: YM_FX_STRATEGY_NAME,
  strategyDescription: 'Private editable YM-Fx strategy playbook.',
  plan: { ...YM_FX_PLAN, title: 'Young-Money-Fx' },
  entryModels: YM_FX_ENTRY_MODELS,
  rules: YM_FX_PLAN_RULES,
  checks: YM_FX_PLAN_CHECKS,
});

seedPlaybook({
  key: YM_20_PLAN_TITLE,
  strategyName: YM_20_STRATEGY_NAME,
  strategyDescription: 'Private editable multi-timeframe liquidity strategy based on the supplied Photon trading-plan documents.',
  plan: YM_20_PLAN,
  entryModels: YM_20_ENTRY_MODELS,
  rules: YM_20_PLAN_RULES,
  checks: YM_20_PLAN_CHECKS,
  idScope: 'young-money-2.0:',
});

statements.push(`INSERT INTO admin_audit_log (id,actor_user_id,target_user_id,action,outcome,metadata,created_at)
  VALUES (${sql(stableId(`audit:${email}:provision`))},${sql(userId)},${sql(userId)},'provision','success',
  ${sql(JSON.stringify({ username: 'young_money', playbook: 'Young-Money-Fx' }))},${sql(timestamp)})
  ON CONFLICT(id) DO NOTHING;`);

const tempDirectory = await mkdtemp(join(tmpdir(), 'young-money-admin-'));
try {
  const sqlFile = join(tempDirectory, 'provision.sql');
  await writeFile(sqlFile, `${statements.join('\n')}\n`, { mode: 0o600 });
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'trade-journal-pro', '--remote', '--file', sqlFile], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`D1 provisioning failed: ${(result.stderr || result.stdout).trim()}`);
  const query = `SELECT id,role FROM users WHERE id=${sql(userId)} AND email=${sql(email)} AND role='admin' AND account_status='active'`;
  const verify = spawnSync('npx', ['wrangler', 'd1', 'execute', 'trade-journal-pro', '--remote', '--json', '--command', query], { encoding: 'utf8' });
  if (verify.status !== 0 || !JSON.parse(verify.stdout).some(batch => batch.results?.some(row => row.id === userId && row.role === 'admin'))) {
    throw new Error('D1 administrator verification failed.');
  }
  console.log('Provisioned and verified the administrator account with its Young-Money-Fx and Young Money 2.0 playbooks.');
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

function recordInsert(ownerId, table, recordId, value, createdAt) {
  const payload = { ...value, user_id: ownerId, id: recordId };
  return `INSERT OR IGNORE INTO workspace_records (id,user_id,table_name,payload,created_at,updated_at)
    VALUES (${sql(recordId)},${sql(ownerId)},${sql(table)},${sql(JSON.stringify(payload))},${sql(createdAt)},${sql(createdAt)});`;
}

function seedPlaybook({ key, strategyName, strategyDescription, plan, entryModels, rules, checks, idScope = '' }) {
  const planId = stableId(`plan:${email}:${key}`);
  const strategyId = stableId(`strategy:${email}:${key}`);
  statements.push(recordInsert(userId, 'trading_plans', planId, plan, timestamp));
  statements.push(recordInsert(userId, 'trader_strategies', strategyId, {
    name: strategyName,
    description: strategyDescription,
    plan_id: planId,
    is_active: true,
  }, timestamp));

  for (const [modelIndex, model] of entryModels.entries()) {
    const modelId = stableId(`entry-model:${email}:${idScope}${modelIndex}:${model.name}`);
    statements.push(recordInsert(userId, 'strategy_entry_models', modelId, {
      strategy_id: strategyId,
      name: model.name,
      description: model.description,
      is_active: true,
    }, timestamp));
    model.checklist.forEach((item, itemIndex) => {
      const itemId = stableId(`entry-check:${email}:${idScope}${modelIndex}:${itemIndex}`);
      statements.push(recordInsert(userId, 'strategy_checklist_items', itemId, {
        strategy_id: strategyId,
        entry_model_id: modelId,
        label: item.label,
        is_required: item.is_required,
        sort_order: itemIndex,
        is_active: true,
      }, timestamp));
    });
  }

  rules.forEach((rule, index) => {
    const ruleId = stableId(`plan-rule:${email}:${idScope}${index}`);
    statements.push(recordInsert(userId, 'trading_rules', ruleId, {
      plan_id: planId,
      rule_text: rule.rule_text,
      category: rule.category,
      priority: index + 1,
      is_active: true,
      times_broken: 0,
    }, timestamp));
  });

  checks.forEach((label, index) => {
    const checkId = stableId(`plan-check:${email}:${idScope}${index}`);
    statements.push(recordInsert(userId, 'pre_trade_checklist', checkId, {
      plan_id: planId,
      label,
      is_required: true,
      sort_order: index,
      is_active: true,
    }, timestamp));
  });
}

function stableId(value) {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
