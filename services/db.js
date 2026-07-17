/**
 * Camada de acesso ao Postgres compartilhado.
 * Usado pelo site principal e (via DATABASE_URL da rede interna do Railway)
 * pelos serviços "Vídeo Homenagem" e "Minhas Músicas".
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.internal') ? false : { rejectUnauthorized: false },
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credits (
      email TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS video_requests (
      id SERIAL PRIMARY KEY,
      request_id TEXT UNIQUE NOT NULL,
      email TEXT,
      nome_destinatario TEXT,
      form_data JSONB,
      brief TEXT,
      uploaded_files JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'submitted',
      audio_url TEXT,
      video_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_video_requests_email ON video_requests(email);
    CREATE INDEX IF NOT EXISTS idx_video_requests_status ON video_requests(status);

    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      email TEXT,
      form_data JSONB,
      status TEXT NOT NULL DEFAULT 'generating_preview',
      job_id TEXT,
      preview_url TEXT,
      download_token TEXT,
      full_audio_url TEXT,
      source TEXT DEFAULT 'site',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_status TEXT;
    CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);

    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      product_type TEXT NOT NULL,
      value_cents INTEGER NOT NULL,
      email TEXT,
      campaign_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_product_type ON sales(product_type);
  `);
}

// ─── Créditos (pacote de 3 músicas) ───

async function grantCredits(email, amount) {
  const normalized = email.toLowerCase().trim();
  const result = await pool.query(
    `INSERT INTO credits (email, balance, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (email) DO UPDATE SET balance = credits.balance + $2, updated_at = now()
     RETURNING balance`,
    [normalized, amount]
  );
  return result.rows[0].balance;
}

async function getCredits(email) {
  const normalized = email.toLowerCase().trim();
  const result = await pool.query(`SELECT balance FROM credits WHERE email = $1`, [normalized]);
  return result.rows[0]?.balance ?? 0;
}

// Decrementa 1 crédito de forma atômica; retorna false se não havia saldo.
async function consumeCredit(email) {
  const normalized = email.toLowerCase().trim();
  const result = await pool.query(
    `UPDATE credits SET balance = balance - 1, updated_at = now()
     WHERE email = $1 AND balance > 0
     RETURNING balance`,
    [normalized]
  );
  return result.rows.length > 0;
}

// ─── Pedidos de Vídeo Homenagem ───

async function createVideoRequest({ requestId, email, formData, brief, uploadedFiles }) {
  await pool.query(
    `INSERT INTO video_requests (request_id, email, nome_destinatario, form_data, brief, uploaded_files)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      requestId,
      email || null,
      formData?.nomeDestinatario || null,
      JSON.stringify(formData || {}),
      brief || null,
      JSON.stringify(uploadedFiles || []),
    ]
  );
}

async function markVideoRequestPaid(requestId, { email, audioUrl }) {
  const result = await pool.query(
    `UPDATE video_requests SET status = 'paid', email = COALESCE($2, email), audio_url = $3, updated_at = now()
     WHERE request_id = $1
     RETURNING *`,
    [requestId, email || null, audioUrl || null]
  );
  return result.rows[0] || null;
}

async function getVideoRequestsByStatus(status) {
  const result = await pool.query(`SELECT * FROM video_requests WHERE status = $1 ORDER BY created_at ASC`, [status]);
  return result.rows;
}

async function getVideoRequestByRequestId(requestId) {
  const result = await pool.query(`SELECT * FROM video_requests WHERE request_id = $1`, [requestId]);
  return result.rows[0] || null;
}

async function getVideoRequestsByEmail(email) {
  const normalized = email.toLowerCase().trim();
  const result = await pool.query(`SELECT * FROM video_requests WHERE email = $1 ORDER BY created_at DESC`, [normalized]);
  return result.rows;
}

async function updateVideoRequestStatus(requestId, status, extra = {}) {
  const fields = ['status = $2', 'updated_at = now()'];
  const values = [requestId, status];
  let i = 3;
  for (const [key, val] of Object.entries(extra)) {
    fields.push(`${key} = $${i}`);
    values.push(val);
    i++;
  }
  await pool.query(`UPDATE video_requests SET ${fields.join(', ')} WHERE request_id = $1`, values);
}

// ─── Pedidos (backup de segurança -- o Map em memória continua sendo a
// fonte "quente"; isso existe pra recuperar em caso de restart/deploy no
// meio do processamento, o que já causou perda real de pedido de cliente) ───

async function saveOrder(order) {
  try {
    await pool.query(
      `INSERT INTO orders (order_id, email, form_data, status, job_id, preview_url, download_token, full_audio_url, source, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (order_id) DO UPDATE SET
         email = EXCLUDED.email,
         form_data = EXCLUDED.form_data,
         status = EXCLUDED.status,
         job_id = EXCLUDED.job_id,
         preview_url = EXCLUDED.preview_url,
         download_token = EXCLUDED.download_token,
         full_audio_url = EXCLUDED.full_audio_url,
         updated_at = now()`,
      [
        order.orderId,
        (order.emailEntrega || order.formData?.emailEntrega || '').toLowerCase().trim() || null,
        JSON.stringify(order.formData || {}),
        order.status || 'generating_preview',
        order.jobId || null,
        order.previewUrl || null,
        order.downloadToken || null,
        order.fullAudioUrl || null,
        order.source || 'site',
      ]
    );
  } catch (err) {
    // Nunca deixa a persistência de backup derrubar o fluxo principal
    console.error('[db] Erro ao salvar order (backup):', err.message);
  }
}

// Atualiza telefone/status de checkout do pedido em QUALQUER evento da Ticto
// (pago ou nao) -- permite listar leads de PIX pendente com telefone pronto
// pra recuperacao, sem depender de export manual do painel da Ticto.
async function updateOrderContact(orderId, email, { phone, checkoutStatus }) {
  try {
    if (orderId) {
      const result = await pool.query(
        `UPDATE orders SET phone = COALESCE($2, phone), checkout_status = COALESCE($3, checkout_status), updated_at = now()
         WHERE order_id = $1 RETURNING order_id`,
        [orderId, phone || null, checkoutStatus || null]
      );
      if (result.rows.length > 0) return;
    }
    const normalized = (email || '').toLowerCase().trim();
    if (normalized) {
      await pool.query(
        `UPDATE orders SET phone = COALESCE($2, phone), checkout_status = COALESCE($3, checkout_status), updated_at = now()
         WHERE order_id = (SELECT order_id FROM orders WHERE email = $1 ORDER BY created_at DESC LIMIT 1)`,
        [normalized, phone || null, checkoutStatus || null]
      );
    }
  } catch (err) {
    console.error('[db] Erro ao atualizar contato do pedido:', err.message);
  }
}

// Lista pedidos sem compra concluida que ja tem telefone capturado --
// e a fila pronta pra recuperacao via WhatsApp.
async function getPendingLeadsWithPhone() {
  const result = await pool.query(
    `SELECT order_id, email, phone, checkout_status, form_data, created_at
     FROM orders
     WHERE phone IS NOT NULL AND status != 'complete'
     ORDER BY created_at DESC`
  );
  return result.rows;
}

async function getOrder(orderId) {
  const result = await pool.query(`SELECT * FROM orders WHERE order_id = $1`, [orderId]);
  return result.rows[0] || null;
}

async function getOrderByEmail(email, status) {
  const normalized = (email || '').toLowerCase().trim();
  const params = [normalized];
  let query = `SELECT * FROM orders WHERE email = $1`;
  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }
  query += ` ORDER BY created_at DESC LIMIT 1`;
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

// Reconstrói o formato usado por global.pendingOrders a partir da linha do Postgres
function orderRowToMemoryFormat(row) {
  return {
    orderId: row.order_id,
    jobId: row.job_id || undefined,
    formData: row.form_data || {},
    emailEntrega: row.email || undefined,
    status: row.status,
    previewUrl: row.preview_url || undefined,
    downloadToken: row.download_token || undefined,
    fullAudioUrl: row.full_audio_url || undefined,
    source: row.source,
    createdAt: row.created_at,
  };
}

// ─── Vendas (fonte de verdade de receita -- gravado toda vez que a Ticto
// confirma pagamento, independente do produto) ───

async function recordSale({ productType, valueCents, email, campaignId }) {
  try {
    await pool.query(
      `INSERT INTO sales (product_type, value_cents, email, campaign_id) VALUES ($1,$2,$3,$4)`,
      [productType, valueCents, (email || '').toLowerCase().trim() || null, campaignId || null]
    );
  } catch (err) {
    console.error('[db] Erro ao registrar venda:', err.message);
  }
}

// Resumo de vendas: total geral + quebra por produto, para hoje / 7 dias / 30 dias / total
async function getSalesSummary() {
  const periods = {
    hoje: `created_at >= date_trunc('day', now())`,
    dias7: `created_at >= now() - interval '7 days'`,
    dias30: `created_at >= now() - interval '30 days'`,
    total: `true`,
  };

  const summary = {};
  for (const [key, whereClause] of Object.entries(periods)) {
    const result = await pool.query(
      `SELECT product_type, COUNT(*)::int AS count, SUM(value_cents)::int AS total_cents
       FROM sales WHERE ${whereClause} GROUP BY product_type`
    );
    const byProduct = {};
    let totalCount = 0, totalCents = 0;
    for (const row of result.rows) {
      byProduct[row.product_type] = { count: row.count, totalCents: row.total_cents };
      totalCount += row.count;
      totalCents += row.total_cents;
    }
    summary[key] = { byProduct, totalCount, totalCents };
  }
  return summary;
}

// Série diária de vendas dos últimos N dias (para gráfico simples)
async function getDailySales(days = 14) {
  const safeDays = Math.max(1, Math.min(90, parseInt(days, 10) || 14)); // sanitiza -- evita injeção via interval
  const result = await pool.query(
    `SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count, SUM(value_cents)::int AS total_cents
     FROM sales
     WHERE created_at >= now() - ($1 || ' days')::interval
     GROUP BY day ORDER BY day ASC`,
    [safeDays]
  );
  return result.rows;
}

module.exports = {
  pool,
  initSchema,
  grantCredits,
  getCredits,
  consumeCredit,
  createVideoRequest,
  markVideoRequestPaid,
  getVideoRequestsByStatus,
  getVideoRequestByRequestId,
  getVideoRequestsByEmail,
  updateVideoRequestStatus,
  saveOrder,
  getOrder,
  getOrderByEmail,
  orderRowToMemoryFormat,
  updateOrderContact,
  getPendingLeadsWithPhone,
  recordSale,
  getSalesSummary,
  getDailySales,
};
