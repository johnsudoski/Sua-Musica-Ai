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
};
