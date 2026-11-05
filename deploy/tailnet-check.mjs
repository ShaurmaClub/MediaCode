#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function isTailnetIP(value) {
  if (net.isIP(value) === 4) { const [a, b] = value.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; }
  return net.isIP(value) === 6 && value.toLowerCase().startsWith('fd7a:115c:a1e0:');
}
export function validTailnetHost(value = '') {
  return isTailnetIP(value) || (/^[a-z0-9][a-z0-9.-]*\.ts\.net\.?$/i.test(value) && !value.includes('..'));
}
export function peerIP(status, host, tag) {
  if (!validTailnetHost(host)) throw new Error('SSH_HOST must be a Tailscale IP or full .ts.net name');
  if (status.BackendState !== 'Running' || !status.Self?.Online || !status.Self?.TailscaleIPs?.some(isTailnetIP)) throw new Error('Runner has no online tailnet identity');
  if (!status.Self.Tags?.includes(tag)) throw new Error('Runner tag does not match Environment');
  const normalize = s => (s || '').replace(/\.$/, '').toLowerCase();
  const peer = Object.values(status.Peer || {}).find(p => p.TailscaleIPs?.includes(host) || normalize(p.DNSName) === normalize(host));
  const ip = peer?.TailscaleIPs?.find(p => net.isIP(p) === 4 && isTailnetIP(p)) || peer?.TailscaleIPs?.find(isTailnetIP);
  if (!ip) throw new Error('Target is not present in the authenticated tailnet peer map');
  return ip;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const host = process.env.SSH_HOST || '';
    if (!validTailnetHost(host)) throw new Error('SSH_HOST must be a Tailscale IP or full .ts.net name; public fallback prohibited');
    if (process.argv.includes('--validate-host')) process.exit(0);
    const tag = process.env.EXPECTED_TS_TAG;
    if (!['tag:mediacode-ci-stage', 'tag:mediacode-ci-prod'].includes(tag)) throw new Error('Invalid Environment CI tag');
    const port = Number(process.env.SSH_PORT || 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH port');
    let target;
    // Peer-map propagation can lag behind ephemeral registration. Bound every wait.
    for (let i = 0; i < 24; i++) {
      const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
      try { if (status.status !== 0) throw new Error(); target = peerIP(JSON.parse(status.stdout), host, tag); } catch { target = undefined; }
      if (target) break;
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    if (!target) throw new Error('Tailnet identity/tag/peer did not become ready within retry budget');
    const ping = spawnSync('tailscale', ['ping', '--c', '1', '--timeout', '10s', target], { encoding: 'utf8', timeout: 15000 });
    if (ping.status !== 0) throw new Error('Private Tailscale peer is unreachable');
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: target, port, timeout: 10000 });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('Private SSH port timed out (check grants/sshd)')); });
      socket.once('error', () => reject(new Error('Private SSH port is unavailable')));
    });
    if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV missing');
    fs.appendFileSync(process.env.GITHUB_ENV, `SSH_TARGET_IP=${target}\n`);
    console.log('Authenticated tailnet identity, Environment tag, private peer and SSH port verified.');
  } catch (err) { console.error(`Tailnet check failed: ${err.message}`); process.exitCode = 10; }
}
