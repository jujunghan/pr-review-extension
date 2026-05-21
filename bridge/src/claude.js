import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';

function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

export async function parseStream(readable, emitter) {
  if (emitter.listenerCount('error') === 0) {
    emitter.on('error', () => {});
  }
  const rl = createInterface({ input: readable, crlfDelay: Infinity });
  let sawResult = false;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch (e) {
      emitter.emit('error', new Error(`malformed JSON line: ${line}`));
      continue;
    }
    if (evt.type === 'assistant' && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === 'text' && block.text) {
          emitter.emit('delta', block.text);
        }
      }
    } else if (evt.type === 'result') {
      sawResult = true;
      emitter.emit('done', { sessionId: evt.session_id });
    }
  }
  if (!sawResult) {
    emitter.emit('error', new Error('stream ended without result event'));
  }
}

export function runClaude({ sessionId, isNew, message, cwd, extraDirs }) {
  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose'];
  if (isNew) {
    args.push('--session-id', sessionId);
  } else {
    args.push('--resume', sessionId);
  }
  if (Array.isArray(extraDirs) && extraDirs.length > 0) {
    args.push('--add-dir', ...extraDirs);
  }
  args.push(message);
  const env = { ...process.env };
  // cmux ships a `claude` wrapper that injects hooks/settings when these
  // env vars are present. The bridge is an independent process and the
  // wrapper's hook callbacks can stall/kill the child. Run as if outside cmux.
  delete env.CMUX_SURFACE_ID;
  delete env.CMUX_WORKSPACE_ID;
  delete env.CMUX_TAB_ID;
  const claudeBin = process.env.PR_REVIEW_CLAUDE_BIN || 'claude';
  return spawn(claudeBin, args, {
    cwd: expandTilde(cwd) || process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
