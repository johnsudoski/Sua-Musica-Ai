/**
 * Painel financeiro interno -- receita real (Postgres) x gasto de anúncios
 * (Meta Ads) x custo estimado de geração. Protegido por token simples
 * (não é um sistema de login completo, só evita acesso aberto ao público).
 */

const express = require('express');
const axios = require('axios');
const db = require('../services/db');

const router = express.Router();

// Campanhas Meta Ads da SuaMúsicaAI (ver agents/cargo/marketing/zeus/DNA-CONFIG.yaml)
const AD_ACCOUNT_ID = 'act_820433344203621';
const CAMPAIGN_IDS = [
  '120250763955750028', // original (InitiateCheckout) -- pausada
  '120250783068620028', // otimização Purchase -- ativa
];

// Custo estimado de geração por produto (Suno/apiframe.ai + Creatomate)
const COST_PER_UNIT = {
  mp3: 0.30,    // 1 música gerada
  video: 0.60,  // 1 música + montagem de vídeo (Creatomate)
  pack3: 0.90,  // até 3 músicas (custo máximo; pode ser menor se nem todos os créditos forem usados)
};

function checkAuth(req, res, next) {
  const token = req.query.token || req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  next();
}

async function getAdSpend() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { total: 0, byCampaign: [], error: 'META_ACCESS_TOKEN não configurado' };

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = new Date().toISOString().slice(0, 10);

  let total = 0;
  const byCampaign = [];
  for (const campaignId of CAMPAIGN_IDS) {
    try {
      const res = await axios.get(`https://graph.facebook.com/v20.0/${campaignId}/insights`, {
        params: {
          access_token: token,
          fields: 'spend,campaign_name',
          time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
        },
        timeout: 10000,
      });
      const row = res.data?.data?.[0];
      const spend = parseFloat(row?.spend || 0);
      total += spend;
      byCampaign.push({ campaignId, name: row?.campaign_name || campaignId, spend });
    } catch (err) {
      byCampaign.push({ campaignId, error: err.message });
    }
  }
  return { total, byCampaign, periodDays: 30 };
}

// ─── GET /api/admin/finance?token=... ───
router.get('/finance', checkAuth, async (req, res) => {
  try {
    const [sales, dailySales, adSpend] = await Promise.all([
      db.getSalesSummary(),
      db.getDailySales(30),
      getAdSpend(),
    ]);

    // Custo estimado de geração (30 dias) baseado no que foi vendido
    let estimatedCost30d = 0;
    for (const [product, data] of Object.entries(sales.dias30.byProduct)) {
      estimatedCost30d += (COST_PER_UNIT[product] || 0.30) * data.count;
    }

    const revenue30d = sales.dias30.totalCents / 100;
    const profit30d = revenue30d - adSpend.total - estimatedCost30d;

    res.json({
      sales,
      dailySales,
      adSpend,
      estimate: {
        estimatedGenerationCost30d: Number(estimatedCost30d.toFixed(2)),
        revenue30d: Number(revenue30d.toFixed(2)),
        adSpend30d: Number(adSpend.total.toFixed(2)),
        profit30d: Number(profit30d.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('[admin/finance] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao gerar painel financeiro.' });
  }
});

module.exports = router;
