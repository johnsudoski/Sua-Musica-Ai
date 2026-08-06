/**
 * Curadoria fixa por gênero para o Order Bump "Playlist Romântica Curada".
 * Título + artista de músicas reais e conhecidas -- não é geração dinâmica
 * por pedido (não existe integração com a API do Spotify neste projeto),
 * é a mesma curadoria para todo cliente do mesmo gênero. Link de busca do
 * Spotify complementa (não é link de uma playlist "montada" -- seria
 * enganoso fingir isso sem a integração real).
 */

const PLAYLISTS = {
  sertanejo: [
    { titulo: 'Loucos Por Você', artista: 'Chitãozinho & Xororó' },
    { titulo: 'Evidências', artista: 'Chitãozinho & Xororó' },
    { titulo: 'É o Amor', artista: 'Zezé Di Camargo & Luciano' },
    { titulo: 'O Que Falta Em Você Sou Eu', artista: 'Marília Mendonça' },
    { titulo: 'Última Saudade', artista: 'Henrique e Juliano' },
  ],
  mpb: [
    { titulo: 'Quem de Nós Dois', artista: 'Ana Carolina' },
    { titulo: 'Eduardo e Mônica', artista: 'Legião Urbana' },
    { titulo: 'Chega de Saudade', artista: 'Tom Jobim / João Gilberto' },
    { titulo: 'Futuros Amantes', artista: 'Chico Buarque' },
    { titulo: 'Leãozinho', artista: 'Caetano Veloso' },
  ],
  pop: [
    { titulo: 'Como É Grande o Meu Amor Por Você', artista: 'Roberto Carlos' },
    { titulo: 'Por Você', artista: 'Sandy & Junior' },
    { titulo: 'Imortal', artista: 'Sandy & Junior' },
    { titulo: 'No Fundo do Coração', artista: 'Sandy & Junior' },
    { titulo: 'A Lenda', artista: 'Sandy & Junior' },
  ],
  romantico: [
    { titulo: 'Como É Grande o Meu Amor Por Você', artista: 'Roberto Carlos' },
    { titulo: 'Quem de Nós Dois', artista: 'Ana Carolina' },
    { titulo: 'Imortal', artista: 'Sandy & Junior' },
    { titulo: 'Evidências', artista: 'Chitãozinho & Xororó' },
    { titulo: 'Eduardo e Mônica', artista: 'Legião Urbana' },
  ],
  pagode: [
    { titulo: 'Me Apaixonei Pela Pessoa Errada', artista: 'Exaltasamba' },
    { titulo: 'É Tarde Demais', artista: 'Raça Negra' },
    { titulo: 'Marrom Bombom', artista: 'Os Morenos' },
    { titulo: 'Depois do Prazer', artista: 'Só Pra Contrariar' },
  ],
  gospel: [
    { titulo: 'Te Amo', artista: 'Bruna Karla' },
    { titulo: 'Que Bom Que Você Chegou', artista: 'Bruna Karla' },
    { titulo: 'Te Amaria Outra Vez', artista: 'Fernanda Brum' },
    { titulo: 'Meu Eterno Namorado', artista: 'Aline Barros' },
    { titulo: 'Nossa Canção de Amor', artista: 'Cassiane e Jairinho' },
  ],
};

function getPlaylist(genero) {
  return PLAYLISTS[genero] || PLAYLISTS.romantico;
}

module.exports = { getPlaylist };
