/**
 * Geração de Carta de Amor via IA (Claude / Anthropic).
 *
 * Requer ANTHROPIC_API_KEY configurada -- sem ela, a função lança erro
 * explícito (nunca inventa texto localmente nem falha silenciosamente).
 */

const axios = require('axios');

const RELACAO_TEXTO = {
  namorado: 'namorado(a)',
  esposo: 'esposo(a)',
  mae: 'mãe',
  pai: 'pai',
  filho: 'filho(a)',
  amigo: 'amigo(a)',
  avo: 'avô/avó',
  irmao: 'irmão/irmã',
};

async function generateLoveLetter({ nomeDestinatario, relacao, memoria }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada -- geração de carta indisponível');
  }

  const relacaoTexto = RELACAO_TEXTO[relacao] || relacao || 'pessoa especial';

  const prompt = `Escreva uma carta de amor em português do Brasil, calorosa e pessoal, para ${nomeDestinatario}, que é ${relacaoTexto} de quem está escrevendo.

Use esta memória especial contada por quem está escrevendo como base real da carta (incorpore os detalhes dela, não invente outros fatos além do que está aqui):
"${memoria}"

Regras:
- Direcione a carta diretamente para ${nomeDestinatario} (2ª pessoa, "você")
- Tom emocional, sincero, não piegas nem genérico -- deve soar como uma pessoa real escrevendo, não um cartão de loja
- Use a memória contada de forma central na carta, não como detalhe solto
- Não invente nomes, datas ou fatos que não estejam na memória fornecida
- Entre 150 e 250 palavras
- Termine com uma despedida carinhosa, sem assinatura (quem recebe já sabe quem enviou)
- Não use markdown, apenas texto corrido com parágrafos separados por linha em branco`;

  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const text = res.data?.content?.[0]?.text;
  if (!text) throw new Error('Resposta da IA sem texto');
  return text.trim();
}

// Temas do Kit "Datas Especiais" -- 12 cartas, uma por ocasião (não por mês
// fixo, já que a compra pode acontecer em qualquer época do ano).
const KIT_TEMAS = [
  'Aniversário de namoro',
  'Dia dos Namorados',
  'Aniversário dela(e)',
  'Pedido de desculpas depois de uma briga',
  'Carta "só porque eu te amo", sem motivo nenhum',
  'Agradecimento por tudo que ela(e) faz',
  'Saudade, para quando estiverem separados por um tempo',
  'Natal / Ano Novo',
  'Reconciliação, para depois de um desentendimento',
  'Véspera de um momento importante (mudança, decisão, viagem)',
  'Celebrando uma conquista dela(e)',
  'Carta sobre o futuro que vocês vão construir juntos',
];

/**
 * Gera as 12 cartas do Kit "Datas Especiais" numa única chamada -- mais
 * barato e mais rápido que 12 chamadas separadas, e garante que a IA varie
 * o tom entre elas em vez de repetir a mesma carta com trocas pequenas.
 * Retorna [{ tema, texto }, ...] na mesma ordem de KIT_TEMAS.
 */
async function generateLoveLetterSet({ nomeDestinatario, relacao, memoria }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada -- geração de carta indisponível');
  }

  const relacaoTexto = RELACAO_TEXTO[relacao] || relacao || 'pessoa especial';
  const temasNumerados = KIT_TEMAS.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const prompt = `Escreva um KIT de 12 cartas de amor curtas em português do Brasil, para ${nomeDestinatario}, que é ${relacaoTexto} de quem está escrevendo. Cada carta é para uma ocasião diferente, nesta ordem exata:
${temasNumerados}

Use esta memória especial contada por quem está escrevendo como base real (incorpore os detalhes dela nas cartas onde fizer sentido -- especialmente nas de aniversário de namoro e "sobre o futuro"; não invente outros fatos além do que está aqui):
"${memoria}"

Regras:
- Cada carta deve ter tom e foco DIFERENTES entre si, correspondendo à ocasião listada -- não repita a mesma estrutura ou frases entre elas
- Direcione cada carta diretamente para ${nomeDestinatario} (2ª pessoa, "você")
- Tom emocional, sincero, não piegas nem genérico -- deve soar como uma pessoa real escrevendo
- Não invente nomes, datas ou fatos que não estejam na memória fornecida
- Cada carta entre 60 e 110 palavras (mais curtas que uma carta única, já que são 12)
- Sem assinatura em nenhuma (quem recebe já sabe quem enviou)
- Não use markdown

Responda em formato JSON puro, um array de 12 objetos, cada um com "tema" (copie o texto exato do tema da lista acima) e "texto" (a carta). Não escreva nada antes ou depois do JSON.`;

  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 60000,
    }
  );

  const text = res.data?.content?.[0]?.text;
  if (!text) throw new Error('Resposta da IA sem texto (kit de cartas)');

  // A IA às vezes envolve o JSON em ```json ... ``` apesar da instrução -- limpa antes de parsear.
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  let letters;
  try {
    letters = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Falha ao parsear JSON do kit de cartas: ${err.message}`);
  }
  if (!Array.isArray(letters) || letters.length === 0) {
    throw new Error('Kit de cartas: resposta da IA não é um array válido');
  }
  return letters;
}

/**
 * Gera o texto "Behind the Scenes" do Upsell Álbum -- explica a inspiração
 * e as escolhas por trás das 5 músicas, baseado nos temas reais usados.
 */
async function generateBehindTheScenes({ nomeDestinatario, relacao, memoria, temas }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada -- geração indisponível');
  }
  const relacaoTexto = RELACAO_TEXTO[relacao] || relacao || 'pessoa especial';
  const temasTexto = temas.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const prompt = `Escreva um texto em português do Brasil chamado "Behind the Scenes" explicando, pra quem encomendou, a inspiração por trás de um álbum de 5 músicas personalizadas criado para ${nomeDestinatario} (${relacaoTexto} de quem encomendou).

As 5 músicas, cada uma sobre um tema diferente:
${temasTexto}

Memória real contada por quem encomendou, usada como base (não invente outros fatos):
"${memoria}"

Regras:
- Tom caloroso, pessoal, como se fosse a "equipe criativa" explicando as escolhas -- não piegas
- Para cada uma das 5 músicas, escreva 1 parágrafo curto (40-60 palavras) explicando por que aquele tema e aquele estilo foram escolhidos
- Não invente fatos além da memória fornecida
- Sem markdown, texto corrido com títulos simples tipo "Música 1: [tema]" antes de cada parágrafo`;

  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 45000,
    }
  );
  const text = res.data?.content?.[0]?.text;
  if (!text) throw new Error('Resposta da IA sem texto (behind the scenes)');
  return text.trim();
}

module.exports = { generateLoveLetter, generateLoveLetterSet, generateBehindTheScenes };
