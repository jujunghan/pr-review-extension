import { createApp } from './src/server.js';
import { runClaude } from './src/claude.js';
import { createSessionStore } from './src/sessions.js';

const PORT = process.env.PORT || 8765;
const sessions = createSessionStore();
const app = createApp({ runClaude, sessions });
app.listen(PORT, () => {
  console.log(`bridge listening on http://localhost:${PORT}`);
});
