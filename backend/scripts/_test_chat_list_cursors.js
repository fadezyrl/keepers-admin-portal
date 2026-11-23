/**
 * Smoke-check listMessages before/after cursor contract against a live DB.
 * Skips cleanly when fixtures are unavailable.
 */
const { query } = require('../src/config/db');
const chatService = require('../src/services/chatService');
const { AppError } = require('../src/utils/AppError');

async function main() {
  const conv = await query(
    `SELECT c.id, cp.user_id
     FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.is_active = TRUE
     JOIN messages m ON m.conversation_id = c.id
     LIMIT 1`,
  );
  if (!conv.rows[0]) {
    console.log(JSON.stringify({ skipped: true, reason: 'No conversation with messages' }));
    return;
  }

  const conversationId = conv.rows[0].id;
  const actor = {
    id: conv.rows[0].user_id,
    permissions: ['chat.read', 'chat.send'],
    roles: ['member'],
  };

  const page = await chatService.listMessages(conversationId, actor, { limit: 5 });
  if (!Array.isArray(page.items)) throw new Error('items missing');

  let afterOk = true;
  if (page.items.length >= 2) {
    const watermark = page.items[0].createdAt;
    const watermarkMs = new Date(watermark).getTime();
    const newer = await chatService.listMessages(conversationId, actor, {
      after: watermark,
      limit: 20,
    });
    afterOk =
      newer.items.length >= 1 &&
      newer.items.every((m) => new Date(m.createdAt).getTime() > watermarkMs);
  }

  let bothRejected = false;
  try {
    await chatService.listMessages(conversationId, actor, {
      before: new Date().toISOString(),
      after: new Date(0).toISOString(),
      limit: 5,
    });
  } catch (err) {
    bothRejected = err instanceof AppError && err.status === 400;
  }

  console.log(
    JSON.stringify({
      ok: afterOk && bothRejected,
      afterOk,
      bothRejected,
      sampleCount: page.items.length,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
