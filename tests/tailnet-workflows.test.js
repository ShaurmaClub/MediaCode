import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTailnetIP, validTailnetHost, peerIP } from '../deploy/tailnet-check.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
test('Only private tailnet addresses/names are accepted; peer map, live identity and exact tag are mandatory', () => {
  for (const ip of ['100.64.0.1', '100.127.255.254', 'fd7a:115c:a1e0::1']) assert.equal(isTailnetIP(ip), true);
  for (const host of ['100.63.1.1', '100.128.1.1', '127.0.0.1', '1.1.1.1', 'example.com', 'vavilon', 'a..ts.net', '-foo.ts.net', 'x;id']) assert.equal(validTailnetHost(host), false, host);
  assert.equal(validTailnetHost('vavilon.tail123.ts.net'), true);
  const status = { BackendState: 'Running', Self: { Online: true, Tags: ['tag:mediacode-ci-stage'], TailscaleIPs: ['100.100.1.1'] },
    Peer: { node: { DNSName: 'vavilon.tail123.ts.net.', TailscaleIPs: ['100.81.97.45'] } } };
  assert.equal(peerIP(status, 'vavilon.tail123.ts.net', 'tag:mediacode-ci-stage'), '100.81.97.45');
  assert.throws(() => peerIP(status, '100.81.97.46', 'tag:mediacode-ci-stage'), /peer map/);
  assert.throws(() => peerIP(status, '100.81.97.45', 'tag:mediacode-ci-prod'), /tag/);
  assert.throws(() => peerIP({ ...status, Self: { ...status.Self, Online: false } }, '100.81.97.45', 'tag:mediacode-ci-stage'), /online/);
});
test('OIDC is scoped to gated deploy jobs and private-route verification precedes any SCP/SSH', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.equal((ci.match(/id-token: write/g) || []).length, 2);
  for (const [contour, tag] of [['staging', 'stage'], ['production', 'prod']]) {
    const block = ci.split(`  deploy-${contour}:`)[1].split('\n  #')[0];
    assert.match(block, /permissions:\n {6}contents: read\n {6}id-token: write/);
    assert.ok(block.includes('uses: tailscale/github-action@v4'));
    assert.ok(block.includes(`tags: tag:mediacode-ci-${tag}`));
    assert.ok(block.includes('audience: ${{ secrets.TS_AUDIENCE }}'));
    assert.ok(block.includes('oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}'));
    assert.ok(block.indexOf('node deploy/tailnet-check.mjs') < block.indexOf('scp -i'));
    assert.ok(block.includes('"${SSH_USER}@${SSH_TARGET_IP}"'));
    assert.equal(block.includes('"${SSH_USER}@${SSH_HOST}"'), false);
    assert.ok(block.includes('StrictHostKeyChecking=yes'));
    assert.ok(block.includes('sudo -n tailscale logout'));
  }
});
test('Manual connectivity is branch/Environment scoped and executes only remote id, even with CD disabled', () => {
  const workflow = read('.github/workflows/ssh-connectivity.yml');
  const expr = workflow.match(/if: >-\r?\n([\s\S]*?)\r?\n {4}runs-on:/)[1].trim();
  const evaluate = new Function('github', 'inputs', `return (${expr})`);
  for (const environment of ['staging', 'production']) for (const branch of ['main', 'dev', 'fix/review']) for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
    assert.equal(evaluate({ event_name: event, ref: `refs/heads/${branch}` }, { environment }),
      event === 'workflow_dispatch' && branch === (environment === 'production' ? 'main' : 'dev'));
  }
  assert.equal(workflow.includes('CD_PRODUCTION_ENABLED'), false);
  const shell = read('deploy/ssh-connectivity.sh');
  assert.equal(/\b(scp|systemctl)\b|git checkout|server\/migrate/.test(shell), false);
  assert.match(shell, /other@\$SSH_TARGET_IP" id -un/);
  assert.match(shell, /wrong" "\$expected@\$SSH_TARGET_IP" id -un/);
});
