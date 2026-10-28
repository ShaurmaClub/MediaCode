#!/usr/bin/env node
// Decode only selected non-credential fields for ADMIN trust configuration.
// This is NOT JWT signature validation; Tailscale independently verifies the token.
import fs from 'node:fs';
try {
  if (!process.env.TS_AUDIENCE || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('OIDC permission or TS_AUDIENCE missing');
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience', process.env.TS_AUDIENCE);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('GitHub rejected OIDC token request');
  const { value } = await r.json();
  const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString());
  const allowlist = ['iss', 'sub', 'repository', 'repository_id', 'repository_owner_id', 'environment', 'ref', 'event_name', 'workflow_ref', 'job_workflow_ref'];
  const safe = Object.fromEntries(allowlist.filter(k => typeof claims[k] === 'string').map(k => [k, claims[k]]));
  if (safe.repository !== process.env.GITHUB_REPOSITORY || safe.ref !== process.env.GITHUB_REF || safe.environment !== process.env.DEPLOY_ENV) throw new Error('Unexpected repository/ref/Environment claim');
  const report = 'OIDC trust metadata (JWT, audience and request credential omitted):\n```json\n' + JSON.stringify(safe, null, 2) + '\n```\n';
  if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('Step summary unavailable');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  console.log('Selected trust claims written to job summary. JWT was neither logged nor stored.');
} catch { console.error('OIDC claim inspection failed; verify Environment, audience and job-level id-token permission.'); process.exitCode = 10; }
