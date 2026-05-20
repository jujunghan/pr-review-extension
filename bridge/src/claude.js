import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

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

export function runClaude({ sessionId, isNew, message, cwd }) {
  const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose'];
  if (isNew) {
    args.push('--session-id', sessionId);
  } else {
    args.push('--resume', sessionId);
  }
  const proc = spawn('claude', args, {
    cwd: cwd || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdin.end(message);
  return proc;
}
