/**
 * Recuperação de preview abandonado.
 *
 * Quem ouviu o preview (status='preview_ready') e não comprou depois de um
 * tempo recebe um lembrete com link direto pro checkout. Rodado em intervalo
 * fixo a partir de server.js -- não é um cron externo, é um setInterval no
 * mesmo processo Node que já fica de pé o tempo todo.
 */

const db = require('./db');
const emailService = require('./email');

const MIN_HOURS = Number(process.env.RECOVERY_EMAIL_DELAY_HOURS || 2);
const MAX_DAYS = Number(process.env.RECOVERY_EMAIL_MAX_DAYS || 3);

async function runAbandonedPreviewRecovery() {
  const abandoned = await db.getAbandonedPreviews({ minHours: MIN_HOURS, maxDays: MAX_DAYS });
  if (!abandoned.length) return;

  console.log(`[recovery] ${abandoned.length} preview(s) abandonado(s) -- enviando lembrete`);

  for (const order of abandoned) {
    const email = order.email || order.form_data?.emailEntrega;
    const nomeDestinatario = order.form_data?.nomeDestinatario;

    // Sem nome ou email utilizável -- não tem como montar o email, marca como
    // tratado pra não ficar tentando pra sempre no mesmo registro quebrado.
    if (!email || !nomeDestinatario) {
      await db.markRecoveryEmailSent(order.order_id).catch(() => {});
      continue;
    }

    try {
      await emailService.sendAbandonedPreviewEmail({ to: email, nomeDestinatario, orderId: order.order_id });
      await db.markRecoveryEmailSent(order.order_id);
      console.log(`[recovery] Lembrete enviado para ${email} (orderId ${order.order_id})`);
    } catch (err) {
      // Não marca como enviado -- tenta de novo no próximo ciclo.
      console.error(`[recovery] Falha ao enviar lembrete (orderId ${order.order_id}):`, err.message);
    }
  }
}

module.exports = { runAbandonedPreviewRecovery };
