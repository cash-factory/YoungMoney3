#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!accessToken) {
  throw new Error('Set SUPABASE_ACCESS_TOKEN in your terminal environment. Do not pass it as a command-line argument or commit it.');
}

const apiBase = 'https://api.supabase.com/v1';
const prompt = createInterface({ input: stdin, output: stdout });
const apiHeaders = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

async function supabaseRequest(path, options = {}) {
  const result = await fetch(`${apiBase}${path}`, { ...options, headers: { ...apiHeaders, ...options.headers } });
  if (!result.ok) {
    const details = await result.text();
    throw new Error(`Supabase API request failed (HTTP ${result.status}): ${details.slice(0, 400)}`);
  }
  if (result.status === 204) return null;
  return result.json();
}

function unwrap(value) {
  return value && typeof value === 'object' && 'result' in value ? value.result : value;
}

function projectReference(project) {
  return project?.ref || project?.id;
}

function printAndChoose(items, label, format, defaultIndex = 0) {
  items.forEach((item, index) => stdout.write(`  ${index + 1}) ${format(item)}${index === defaultIndex ? ' (recommended)' : ''}\n`));
  return prompt.question(`${label} [${defaultIndex + 1}]: `).then(answer => {
    const choice = answer.trim() ? Number(answer) : defaultIndex + 1;
    if (!Number.isInteger(choice) || choice < 1 || choice > items.length) {
      throw new Error(`Choose a number from 1 to ${items.length}.`);
    }
    return items[choice - 1];
  });
}

function setWorkerSecret(name, value) {
  const wranglerEnvironment = { ...process.env };
  delete wranglerEnvironment.SUPABASE_ACCESS_TOKEN;
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--name', 'ym-fx'], {
    input: `${value}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],
    env: wranglerEnvironment,
  });
  if (result.status !== 0) throw new Error(`Could not configure Cloudflare Worker secret ${name}.`);
}

async function setupPrivateBucket(projectUrl, serviceRoleKey) {
  const endpoint = `${projectUrl}/storage/v1/bucket`;
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' };
  const configuration = {
    id: 'trading-media',
    name: 'trading-media',
    public: false,
    file_size_limit: 15 * 1024 * 1024,
    allowed_mime_types: [
    'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
      'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-wav',
    ],
  };

  const existing = await fetch(`${endpoint}/trading-media`, { headers });
  if (existing.ok) {
    const update = await fetch(`${endpoint}/trading-media`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        public: false,
        file_size_limit: configuration.file_size_limit,
        allowed_mime_types: configuration.allowed_mime_types,
      }),
    });
    if (!update.ok) throw new Error(`Could not update private bucket settings (HTTP ${update.status}).`);
    return;
  }
  if (existing.status !== 404) throw new Error(`Could not check the media bucket (HTTP ${existing.status}).`);

  const created = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(configuration) });
  if (!created.ok && created.status !== 409) throw new Error(`Could not create the private media bucket (HTTP ${created.status}).`);
}

async function waitForProject(ref) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const project = unwrap(await supabaseRequest(`/projects/${encodeURIComponent(ref)}`));
    if (project.status === 'ACTIVE_HEALTHY') return project;
    if (['INIT_FAILED', 'RESTORE_FAILED', 'PAUSE_FAILED', 'REMOVED'].includes(project.status)) {
      throw new Error(`Supabase project setup ended with status ${project.status}.`);
    }
    stdout.write(`Supabase project status: ${project.status || 'starting'}; checking again in 10 seconds.\n`);
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new Error('Supabase project did not become healthy within 10 minutes; check the Supabase dashboard before retrying.');
}

try {
  const rawOrganizations = unwrap(await supabaseRequest('/organizations'));
  const organizations = Array.isArray(rawOrganizations) ? rawOrganizations : [];
  if (!organizations.length) throw new Error('This Supabase account has no organization available for project creation.');

  const organization = organizations.length === 1
    ? organizations[0]
    : await printAndChoose(organizations, 'Select the Supabase organization', item => `${item.name} (${item.slug})`);
  const slug = organization.slug;
  if (!slug) throw new Error('The selected Supabase organization has no slug.');

  const regionResponse = unwrap(await supabaseRequest(`/projects/available-regions?organization_slug=${encodeURIComponent(slug)}&continent=AF`));
  const regionInfo = regionResponse?.recommendations || regionResponse?.all || {};
  const regions = [
    ...(regionInfo.smartGroup || []),
    ...(regionInfo.specific || []),
  ].filter(region => region?.code && region?.type);
  if (!regions.length) throw new Error('Supabase did not return any regions available for this organization.');
  const preferredIndex = Math.max(0, regions.findIndex(region => region.type === 'smartGroup' && region.code === 'emea'));
  const region = await printAndChoose(
    regions,
    'Select the project data region',
    item => `${item.name} (${item.code})`,
    preferredIndex,
  );

  const projectNameAnswer = await prompt.question('Project name [ym-fx-media]: ');
  const projectName = projectNameAnswer.trim() || 'ym-fx-media';
  if (projectName.length > 64) throw new Error('Choose a project name of 64 characters or fewer.');

  const existingResponse = unwrap(await supabaseRequest(`/organizations/${encodeURIComponent(slug)}/projects?search=${encodeURIComponent(projectName)}&limit=100`));
  const projects = Array.isArray(existingResponse) ? existingResponse : (existingResponse?.projects || []);
  const existingProject = projects.find(project => project.name?.toLowerCase() === projectName.toLowerCase() && !project.is_branch);
  let project;
  if (existingProject) {
    const answer = await prompt.question(`A project named "${existingProject.name}" already exists. Reuse it? [Y/n]: `);
    if (/^(n|no)$/i.test(answer.trim())) throw new Error('Stopped to avoid creating a duplicate project. Choose a different project name and run again.');
    project = existingProject;
    stdout.write(`Reusing existing project ${project.name} (${project.ref}).\n`);
  } else {
    const answer = await prompt.question(`Create a free-tier Supabase project named "${projectName}" in ${region.name}? [y/N]: `);
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Supabase project creation cancelled.');
    const projectPassword = randomBytes(36).toString('base64url');
    const createBody = {
      name: projectName,
      organization_slug: slug,
      db_pass: projectPassword,
      region_selection: { type: region.type, code: region.code },
    };
    project = unwrap(await supabaseRequest('/projects', { method: 'POST', body: JSON.stringify(createBody) }));
    stdout.write(`Created Supabase project ${project.name} (${project.ref}). Waiting for it to become ready.\n`);
  }

  const ref = projectReference(project);
  if (!ref) throw new Error('Supabase did not return a project reference.');
  await waitForProject(ref);

  const rawKeys = unwrap(await supabaseRequest(`/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`));
  const keys = Array.isArray(rawKeys) ? rawKeys : [];
  const serviceRoleKey = keys.find(item => item.name === 'service_role' && item.api_key)?.api_key;
  if (!serviceRoleKey) throw new Error('Could not retrieve the Supabase service_role key. Check project API-key access, then retry.');

  const projectUrl = `https://${ref}.supabase.co`;
  await setupPrivateBucket(projectUrl, serviceRoleKey);
  setWorkerSecret('SUPABASE_URL', projectUrl);
  setWorkerSecret('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey);

  stdout.write('\nSupabase media setup complete.\n');
  stdout.write(`Project: ${project.name}\nRegion: ${project.region || region.code}\nProject URL: ${projectUrl}\n`);
  stdout.write('Private bucket: trading-media (15 MiB per object)\nCloudflare Worker secrets: configured; secret values were not printed.\n');
  stdout.write('Next: redeploy the YM-Fx Worker and verify a private image and voice-note upload.\n');
} finally {
  prompt.close();
}
