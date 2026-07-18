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

module.exports = { generateLoveLetter };
