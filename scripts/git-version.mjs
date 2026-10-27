import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Snapshot the source identity; the generated offline manifest is not an edit. */
export function gitVersion(cwd = fileURLToPath(new URL('../', import.meta.url))) {
  try {
    const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const [commit, commitDate] = git(['show', '-s', '--format=%H%n%cI', 'HEAD']).split('\n');
    if (!/^[a-f0-9]{40,64}$/.test(commit) || !Number.isFinite(Date.parse(commitDate))) throw new Error('Invalid Git metadata');
    const dirty = Boolean(git(['status', '--porcelain=v1', '--untracked-files=normal', '--', '.', ':!dist/offline-assets.js']));
    return { commit, commitDate, dirty };
  } catch {
    return { commit: null, commitDate: null, dirty: null };
  }
}
