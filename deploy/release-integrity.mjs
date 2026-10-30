// Content inventory for immutable reuse; live data/uploads are external, not inventoried.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const inventoryName = '.release-inventory.json';
export function inventory(root) {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Release cannot be a link');
  const contour = path.basename(path.dirname(path.dirname(root)));
  if (!['production', 'staging'].includes(contour)) throw new Error('Unknown release Environment');
  const entries = [];
  for (const name of ['data', 'uploads']) {
    const full = path.join(root, name), expected = `/var/lib/mediacode/${contour}/${name}`;
    // Read only the link itself. Target may be private/inaccessible to deploy.
    if (!fs.lstatSync(full).isSymbolicLink() || fs.readlinkSync(full) !== expected) throw new Error('Invalid external data link');
    entries.push([name, 'external-link', expected]);
  }
  function walk(dir, relative = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      if (!relative && [inventoryName, 'data', 'uploads'].includes(name)) continue;
      if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) throw new Error('Environment in release');
      const full = path.join(dir, name), info = fs.lstatSync(full);
      if (info.isSymbolicLink()) {
        if (!fs.realpathSync(full).startsWith(root + path.sep)) throw new Error('Escaping code link');
        entries.push([rel, 'link', fs.readlinkSync(full)]);
      } else if (info.isDirectory()) {
        entries.push([rel, 'dir']); walk(full, rel);
      } else if (info.isFile()) {
        entries.push([rel, 'file', crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);
      } else throw new Error('Special file');
    }
  }
  walk(root);
  return entries;
}
export function verify(root) {
  const file = path.join(root, inventoryName);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Inventory link');
  return JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) === JSON.stringify(inventory(root));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, root, ...extra] = process.argv.slice(2);
    if (!['--record', '--verify'].includes(mode) || !root || extra.length) throw new Error('Invalid arguments');
    if (mode === '--record') {
      const code = fs.realpathSync(root), parent = path.dirname(path.dirname(code));
      for (const link of ['current', 'previous']) {
        const target = path.join(parent, link);
        if (fs.existsSync(target) && fs.realpathSync(target) === code) throw new Error('Referenced release');
      }
      fs.writeFileSync(path.join(root, inventoryName), JSON.stringify(inventory(root)), { flag: 'wx', mode: 0o640 });
    } else if (!verify(root)) throw new Error('Changed content');
  } catch { console.error('Release integrity rejected; preserve files for administrator recovery.'); process.exitCode = 21; }
}
