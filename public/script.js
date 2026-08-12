/* ═══════════════════════════════════════════════
   SuaMúsicaAI — Frontend Logic
   Fluxo: POST /generate-preview → jobId → poll /preview-status/:jobId → showPreview
═══════════════════════════════════════════════ */

var API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : '';

// ─── Meta Click/Browser IDs (melhora o match quality do Conversions API) ───
function getCookie(name) {
  var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function getOrStoreFbc() {
  var fbclid = new URLSearchParams(window.location.search).get('fbclid');
  if (fbclid) {
    var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
    try { localStorage.setItem('sua_musica_fbc', fbc); } catch (_) {}
    return fbc;
  }
  try { return localStorage.getItem('sua_musica_fbc'); } catch (_) { return null; }
}

var _metaFbc = getOrStoreFbc();

// ─── UTM real do anúncio (Meta Ads) — capturada na entrada e repassada pro
// checkout da Ticto. NÃO mexe em utm_campaign: esse parâmetro já é usado
// como ID interno do pedido (ver webhook.js), então a UTM real do anúncio
// vai em utm_source/utm_medium/utm_content/utm_term, que até agora nunca
// eram repassados — por isso a Utmify não conseguia atribuir a venda a
// nenhuma campanha (achado em 2026-08-11, ver docs/ads/). ───
function getOrStoreAdUtms() {
  var params = new URLSearchParams(window.location.search);
  var incoming = {
    utm_source:  params.get('utm_source'),
    utm_medium:  params.get('utm_medium'),
    utm_content: params.get('utm_content'),
    utm_term:    params.get('utm_term'),
  };
  var hasIncoming = Object.keys(incoming).some(function (k) { return incoming[k]; });
  if (hasIncoming) {
    try { localStorage.setItem('sua_musica_ad_utms', JSON.stringify(incoming)); } catch (_) {}
    return incoming;
  }
  try {
    var stored = localStorage.getItem('sua_musica_ad_utms');
    return stored ? JSON.parse(stored) : {};
  } catch (_) { return {}; }
}

var _adUtms = getOrStoreAdUtms();

// ─── Prova de demanda real (substitui "alta demanda" genérica por número real) ───
fetch(API_BASE + '/api/stats/live')
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (!data.count || data.count < 3) return; // não força "demanda alta" se o número for baixo
    var titleEl = document.getElementById('scarcityTitle');
    var textEl = document.getElementById('scarcityText');
    if (titleEl) titleEl.textContent = '🔴 ' + data.count + ' pessoas criaram sua música nas últimas 24h';
    if (textEl) textEl.textContent = 'Crie a sua agora antes que o preview demore mais pra ficar pronto.';
  })
  .catch(function() {});

// ─── Nav estilo Netflix: transparente no topo, sólida ao rolar ───
var _mainNav = document.getElementById('mainNav');
function updateNavScroll() {
  if (!_mainNav) return;
  _mainNav.classList.toggle('scrolled', window.scrollY > 60);
}
window.addEventListener('scroll', updateNavScroll, { passive: true });
updateNavScroll();

// ─── Countdown real: expira toda semana (domingo 23:59:59), não é fake
// por-visitante -- todo mundo que visita na mesma semana vê o mesmo prazo,
// e ele de fato reseta quando a semana vira. ───
function nextSundayMidnight() {
  var now = new Date();
  var day = now.getDay(); // 0 = domingo
  var daysUntilSunday = (7 - day) % 7;
  var target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSunday, 23, 59, 59);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target;
}
function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  var totalSec = Math.floor(ms / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  function pad(n) { return String(n).padStart(2, '0'); }
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}
function tickCountdown() {
  var target = nextSundayMidnight();
  var text = formatCountdown(target - new Date());
  var el1 = document.getElementById('countdownText');
  var el2 = document.getElementById('countdownText2');
  if (el1) el1.textContent = text;
  if (el2) el2.textContent = text;
}
tickCountdown();
setInterval(tickCountdown, 1000);

// ─── Depoimentos reais (nunca fabricados -- some se não houver volume ainda) ───
fetch(API_BASE + '/api/reviews/approved?limit=6')
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var reviews = (data && data.reviews) || [];
    if (reviews.length < 3) return; // pouco volume ainda -- melhor esconder que parecer vazio

    var section = document.getElementById('storiesSection');
    var grid = document.getElementById('storiesGrid');
    var subtitle = document.getElementById('storiesSubtitle');
    if (!section || !grid) return;

    fetch(API_BASE + '/api/reviews/stats')
      .then(function(r) { return r.json(); })
      .then(function(stats) {
        if (subtitle && stats.total) {
          subtitle.textContent = stats.total + ' avaliações reais · média ' + stats.media.toFixed(1) + '★';
        }
      })
      .catch(function() {});

    reviews.forEach(function(review) {
      var nome = review.nomeDestinatario || 'um presenteado';
      var initial = nome.charAt(0).toUpperCase();
      var stars = '★★★★★☆☆☆☆☆'.slice(5 - review.rating, 10 - review.rating);

      var card = document.createElement('div');
      card.className = 'story-card';

      var header = document.createElement('div');
      header.className = 'story-header';
      var avatar = document.createElement('div');
      avatar.className = 'story-avatar';
      avatar.textContent = initial;
      var nameBlock = document.createElement('div');
      var nameEl = document.createElement('div');
      nameEl.className = 'story-name';
      nameEl.textContent = 'Presente para ' + nome;
      nameBlock.appendChild(nameEl);
      header.appendChild(avatar);
      header.appendChild(nameBlock);

      var starsEl = document.createElement('div');
      starsEl.className = 'story-stars';
      starsEl.textContent = stars;

      var textEl = document.createElement('p');
      textEl.className = 'story-text';
      textEl.textContent = '"' + review.texto + '"'; // textContent -- nunca innerHTML com texto de usuário

      card.appendChild(header);
      card.appendChild(starsEl);
      card.appendChild(textEl);
      grid.appendChild(card);
    });

    section.style.display = 'block';
  })
  .catch(function() {});

// ─── FAQ accordion ───
document.querySelectorAll('.faq-q').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var item = btn.closest('.faq-item');
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(i) { i.classList.remove('open'); });
    if (!isOpen) item.classList.add('open');
  });
});

// ─── Contador de caracteres ───
var textarea = document.getElementById('memoria');
var charCountEl = document.getElementById('charCount');
if (textarea && charCountEl) {
  textarea.addEventListener('input', function() {
    charCountEl.textContent = textarea.value.length;
  });
}

// ─── Quiz multi-step (substitui o formulário estático) ───
// Preenche os mesmos campos hidden que o submit handler abaixo já lê --
// não precisa mudar a lógica de envio, só como os dados chegam até ela.
(function initQuiz() {
  var quizContainer = document.getElementById('quizContainer');
  if (!quizContainer) return;

  var steps = Array.prototype.slice.call(quizContainer.querySelectorAll('.quiz-step'));
  var totalSteps = steps.length;
  var currentStep = 1;
  var progressBar = document.getElementById('quizProgressBar');
  var stepNumEl = document.getElementById('quizStepNum');
  var backBtn = document.getElementById('quizBackBtn');
  var quizState = { comoConheceram: null, encanta: null };

  window._quizContainer = quizContainer; // usado pelo submit handler pra esconder no loading

  function goToStep(n, skipScroll) {
    if (n < 1) n = 1;
    if (n > totalSteps) n = totalSteps;
    currentStep = n;
    steps.forEach(function(s) { s.classList.toggle('active', Number(s.getAttribute('data-step')) === currentStep); });
    if (progressBar) progressBar.style.width = ((currentStep / totalSteps) * 100) + '%';
    if (stepNumEl) stepNumEl.textContent = currentStep;
    if (backBtn) backBtn.style.display = currentStep === 1 ? 'none' : 'block';
    if (skipScroll) return; // init da página não deve rolar — lead precisa ver o vídeo primeiro
    requestAnimationFrame(function() {
      var rect = quizContainer.getBoundingClientRect();
      if (rect.top < 0 || rect.top > 220) {
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        window.scrollTo({ top: scrollTop + rect.top - 100, behavior: 'smooth' });
      }
    });
  }

  if (backBtn) backBtn.addEventListener('click', function() { goToStep(currentStep - 1); });

  // Step 1: relação (cartão único, avança sozinho)
  var relacaoCards = quizContainer.querySelectorAll('#quizRelacao .quiz-card');
  relacaoCards.forEach(function(card) {
    card.addEventListener('click', function() {
      relacaoCards.forEach(function(c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      var relacaoInput = document.getElementById('relacao');
      if (relacaoInput) relacaoInput.value = card.getAttribute('data-value');
      setTimeout(function() { goToStep(2); }, 250);
    });
  });

  // Step 2: nome
  var nomeInput = document.getElementById('nomeDestinatario');
  var nomeNextBtn = document.getElementById('qNomeNext');
  if (nomeInput) {
    nomeInput.addEventListener('input', function() {
      if (nomeNextBtn) nomeNextBtn.disabled = nomeInput.value.trim().length < 2;
    });
    nomeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && nomeInput.value.trim().length >= 2) { e.preventDefault(); goToStep(3); }
    });
  }
  if (nomeNextBtn) nomeNextBtn.addEventListener('click', function() { if (!nomeNextBtn.disabled) goToStep(3); });

  // Step 3: como se conheceram (chip único, avança sozinho)
  var comoCards = quizContainer.querySelectorAll('#quizComoConheceram .quiz-chip');
  comoCards.forEach(function(chip) {
    chip.addEventListener('click', function() {
      comoCards.forEach(function(c) { c.classList.remove('selected'); });
      chip.classList.add('selected');
      quizState.comoConheceram = chip.getAttribute('data-value');
      setTimeout(function() { goToStep(4); }, 250);
    });
  });

  // Step 4: o que encanta (chip) + detalhe opcional -> monta a "memoria" que o backend espera
  var encantaCards = quizContainer.querySelectorAll('#quizEncanta .quiz-chip');
  var detalheNextBtn = document.getElementById('qDetalheNext');
  encantaCards.forEach(function(chip) {
    chip.addEventListener('click', function() {
      encantaCards.forEach(function(c) { c.classList.remove('selected'); });
      chip.classList.add('selected');
      quizState.encanta = chip.getAttribute('data-value');
      if (detalheNextBtn) detalheNextBtn.disabled = false;
    });
  });
  if (detalheNextBtn) {
    detalheNextBtn.addEventListener('click', function() {
      if (!quizState.encanta) return;
      var detalheEl = document.getElementById('qDetalhe');
      var nome = (document.getElementById('nomeDestinatario') || { value: '' }).value.trim();
      var partes = [];
      if (quizState.comoConheceram) partes.push('Nos conhecemos ' + quizState.comoConheceram + '.');
      partes.push('O que mais me encanta n' + (nome ? 'o(a) ' + nome : 'ele/ela') + ' é ' + quizState.encanta + '.');
      if (detalheEl && detalheEl.value.trim()) partes.push(detalheEl.value.trim());
      var memoriaEl = document.getElementById('memoria');
      if (memoriaEl) memoriaEl.value = partes.join(' ');
      goToStep(5);
    });
  }

  // Step 5: gênero (cartão único, avança sozinho)
  var generoMap = { sertanejo: 'generoSertanejo', pop: 'generoPop', mpb: 'generoMpb', romantico: 'generoRomantico', pagode: 'generoPagode', gospel: 'generoGospel' };
  var generoCards = quizContainer.querySelectorAll('#quizGenero .quiz-card');
  generoCards.forEach(function(card) {
    card.addEventListener('click', function() {
      generoCards.forEach(function(c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      var radioId = generoMap[card.getAttribute('data-value')];
      var radio = radioId && document.getElementById(radioId);
      if (radio) radio.checked = true;
      setTimeout(function() { goToStep(6); }, 250);
    });
  });

  // Step 6: voz (cartão único, avança sozinho)
  var vozCards = quizContainer.querySelectorAll('#quizVoz .quiz-card');
  vozCards.forEach(function(card) {
    card.addEventListener('click', function() {
      vozCards.forEach(function(c) { c.classList.remove('selected'); });
      card.classList.add('selected');
      var isMasc = card.getAttribute('data-value') === 'masculino';
      var radio = document.getElementById(isMasc ? 'vozMasculino' : 'vozFeminino');
      if (radio) radio.checked = true;
      setTimeout(function() { goToStep(7); }, 250);
    });
  });

  // Reseta o quiz pro estado inicial (usado pelo botão "criar para outra pessoa")
  window._resetQuiz = function() {
    quizState = { comoConheceram: null, encanta: null };
    [relacaoCards, comoCards, encantaCards, generoCards, vozCards].forEach(function(group) {
      group.forEach(function(el) { el.classList.remove('selected'); });
    });
    if (nomeInput) nomeInput.value = '';
    if (nomeNextBtn) nomeNextBtn.disabled = true;
    var detalheEl = document.getElementById('qDetalhe');
    if (detalheEl) detalheEl.value = '';
    if (detalheNextBtn) detalheNextBtn.disabled = true;
    var relacaoInput = document.getElementById('relacao');
    if (relacaoInput) relacaoInput.value = '';
    var memoriaEl = document.getElementById('memoria');
    if (memoriaEl) memoriaEl.value = '';
    quizContainer.classList.remove('hidden');
    goToStep(1);
  };

  goToStep(1, true); // init — sem rolar, o lead precisa ver o vídeo antes do formulário
})();

// ─── Estado ───
var _orderId         = null;
var _previewUrl      = null;
var _pollTO          = null;
var _pollDone        = false;
var _loadTimerTO     = null;
var _loadTimerSec    = 0;
var _previewTO       = null;
var _previewSec      = 0;
var _audioPlaying    = false;
var _post30Triggered = false;
var _timeUpdateFn    = null;

// ─── DOM ───
var form           = document.getElementById('musicForm');
var generateBtn    = document.getElementById('generateBtn');
var loadingSection = document.getElementById('loadingSection');
var loadingText    = document.getElementById('loadingText');
var previewSection = document.getElementById('previewSection');
var playBtn        = document.getElementById('playBtn');
var buyBtnMp3      = document.getElementById('buyBtnMp3');
var buyBtnVideo    = document.getElementById('buyBtnVideo');
var buyBtnPack3    = document.getElementById('buyBtnPack3');
var audioEl        = document.getElementById('previewAudio');

// ─── Timer de carregamento (setTimeout recursivo) ───
function startLoadTimer() {
  _loadTimerSec = 0;
  function tick() {
    _loadTimerSec++;
    var el = document.getElementById('loadingTimer');
    if (el) el.textContent = _loadTimerSec + 's';
    if (loadingText) {
      if (_loadTimerSec < 30) {
        loadingText.innerHTML = 'Compondo a letra com a história de vocês... <span id="loadingTimer">' + _loadTimerSec + 's</span>';
      } else if (_loadTimerSec < 70) {
        loadingText.innerHTML = 'Criando a melodia e os arranjos... <span id="loadingTimer">' + _loadTimerSec + 's</span>';
      } else {
        loadingText.innerHTML = 'Finalizando sua música única... <span id="loadingTimer">' + _loadTimerSec + 's</span>';
      }
    }
    _loadTimerTO = setTimeout(tick, 1000);
  }
  _loadTimerTO = setTimeout(tick, 1000);
}

function stopLoadTimer() {
  if (_loadTimerTO) { clearTimeout(_loadTimerTO); _loadTimerTO = null; }
}

// ─── Polling do status do job (setTimeout recursivo — sem setInterval) ───
function startPolling(jobId, nome) {
  _pollDone = false;

  function doPoll() {
    if (_pollDone) return;

    fetch(API_BASE + '/api/preview-status/' + jobId)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (_pollDone) return;

        if (data.status === 'ready' && data.previewUrl) {
          _pollDone = true;
          stopLoadTimer();
          _orderId = data.orderId || _orderId;
          // Pixel: Lead — preview gerado com sucesso
          if (typeof fbq !== 'undefined') fbq('track', 'Lead');
          showPreview(data.previewUrl, nome);

        } else if (data.status === 'error') {
          _pollDone = true;
          stopLoadTimer();
          resetUI('Não conseguimos gerar a música. Tente novamente em instantes.');

        } else {
          // Ainda gerando — tenta novamente em 5s
          _pollTO = setTimeout(doPoll, 5000);
        }
      })
      .catch(function() {
        if (!_pollDone) _pollTO = setTimeout(doPoll, 6000);
      });
  }

  // Primeira checagem após 15s (a geração leva ~60-90s total)
  _pollTO = setTimeout(doPoll, 15000);
}

// ─── Mostrar preview ───
function showPreview(url, nome) {
  _previewUrl = url;

  if (loadingSection) loadingSection.classList.add('hidden');
  if (previewSection) {
    previewSection.classList.remove('hidden');
    // Scroll suave sem travar: usa requestAnimationFrame para não bloquear
    requestAnimationFrame(function() {
      var rect = previewSection.getBoundingClientRect();
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      window.scrollTo({ top: scrollTop + rect.top - 80, behavior: 'smooth' });
    });
  }
  if (generateBtn) {
    generateBtn.disabled  = false;
    generateBtn.textContent = '🎧 Criar outra música';
  }

  // Configurar áudio
  if (audioEl) {
    audioEl.src = url;
    audioEl.load();

    // Limitar a 40 segundos — função nomeada para poder remover o listener depois
    if (_timeUpdateFn) audioEl.removeEventListener('timeupdate', _timeUpdateFn);
    _post30Triggered = false;
    _timeUpdateFn = function() {
      if (_post30Triggered) return;
      if (audioEl.currentTime >= 40) {
        _post30Triggered = true;
        audioEl.pause();
        audioEl.currentTime = 40;
        _audioPlaying = false;
        if (playBtn) playBtn.textContent = '▶ Ouvir preview novamente';
        showPost30(nome);
      }
    };
    audioEl.addEventListener('timeupdate', _timeUpdateFn);

    // Tentar auto-play
    var pp = audioEl.play();
    if (pp && typeof pp.catch === 'function') {
      pp.then(function() { _audioPlaying = true; if (playBtn) playBtn.textContent = '⏸ Pausar'; })
        .catch(function() {
          if (playBtn) playBtn.textContent = '▶ Toque para ouvir os primeiros 40 segundos';
        });
    }
  }
}

// ─── CTA pós-30 segundos ───
function showPost30(nome) {
  var post30 = document.getElementById('post30Cta');
  if (!post30) return;
  var nomeEl = document.getElementById('post30Nome');
  if (nomeEl && nome) nomeEl.textContent = nome;
  post30.style.display = 'block';
  requestAnimationFrame(function() {
    var rect = post30.getBoundingClientRect();
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    window.scrollTo({ top: scrollTop + rect.top - 80, behavior: 'smooth' });
  });
}

// ─── Resetar UI após erro ───
function resetUI(msg) {
  stopLoadTimer();
  if (loadingSection) loadingSection.classList.add('hidden');
  if (window._quizContainer) window._quizContainer.classList.remove('hidden');
  if (generateBtn) {
    generateBtn.disabled  = false;
    generateBtn.textContent = '🎧 Ouvir meu preview grátis agora';
  }
  if (msg) alert(msg);
}

// ─── Botão play/pause ───
if (playBtn) {
  playBtn.addEventListener('click', function() {
    if (!audioEl || !audioEl.src) return;
    if (_audioPlaying) {
      audioEl.pause();
      _audioPlaying = false;
      playBtn.textContent = '▶ Ouvir preview grátis';
    } else {
      if (audioEl.currentTime >= 40) {
        audioEl.currentTime = 0;
        _post30Triggered = false;
      }
      audioEl.play().then(function() {
        _audioPlaying = true;
        playBtn.textContent = '⏸ Pausar';
      }).catch(function() {});
    }
  });
}

// ─── Submit do formulário ───
if (form) {
  form.addEventListener('submit', function(e) {
    e.preventDefault();

    var nome    = (document.getElementById('nomeDestinatario') || {value:''}).value.trim();
    var relacao = (document.getElementById('relacao') || {value:''}).value;
    var memoria = (document.getElementById('memoria') || {value:''}).value.trim();
    var gEl     = document.querySelector('input[name="genero"]:checked');
    var genero  = gEl ? gEl.value : '';
    var vozEl   = document.querySelector('input[name="voz"]:checked');
    var voz     = vozEl ? vozEl.value : 'feminino';
    var email   = (document.getElementById('emailEntrega') || {value:''}).value.trim();

    if (!nome || !relacao || !memoria) {
      alert('Preencha todos os campos para criar a música 🎵');
      return;
    }
    if (!genero) {
      alert('Escolha um estilo musical 🎸');
      return;
    }

    // Reset de estado anterior
    _pollDone = false;
    if (_pollTO) { clearTimeout(_pollTO); _pollTO = null; }
    if (audioEl) { audioEl.pause(); audioEl.src = ''; }
    if (_timeUpdateFn && audioEl) { audioEl.removeEventListener('timeupdate', _timeUpdateFn); _timeUpdateFn = null; }
    _post30Triggered = false;
    _audioPlaying = false;
    _previewUrl   = null;

    // UI: loading
    if (generateBtn) { generateBtn.disabled = true; generateBtn.textContent = '⏳ Criando sua música...'; }
    if (window._quizContainer) window._quizContainer.classList.add('hidden');
    if (loadingSection) loadingSection.classList.remove('hidden');
    if (previewSection) previewSection.classList.add('hidden');
    var p30 = document.getElementById('post30Cta');
    if (p30) p30.style.display = 'none';
    if (loadingSection) loadingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

    startLoadTimer();

    // POST → recebe jobId imediatamente (~2s)
    fetch(API_BASE + '/api/generate-preview', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        nomeDestinatario: nome,
        relacao:          relacao,
        memoria:          memoria,
        genero:           genero,
        voz:              voz,
        emailEntrega:     email,
        fbp:              getCookie('_fbp'),
        fbc:              _metaFbc,
      }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success || !data.jobId) {
        throw new Error(data.error || 'Erro ao iniciar geração');
      }
      _orderId = data.orderId;
      startPolling(data.jobId, nome);
    })
    .catch(function(err) {
      resetUI('Ops! ' + (err.message || 'Erro inesperado') + '. Tente novamente.');
    });
  });
}

// ─── Abrir checkout ───
function openCheckout(productType) {
  var email = (document.getElementById('emailEntrega') || {value:''}).value;
  var nome  = (document.getElementById('nomeDestinatario') || {value:''}).value;

  if (_orderId) sessionStorage.setItem('sua_musica_orderId', _orderId);
  if (nome)     sessionStorage.setItem('sua_musica_nome', nome);
  if (_previewUrl) sessionStorage.setItem('sua_musica_previewUrl', _previewUrl);
  sessionStorage.setItem('sua_musica_product', productType);

  var checkoutUrls = {
    mp3:   window._checkoutUrlMp3   || 'https://checkout.ticto.app/OD11F0BEB',
    video: window._checkoutUrlVideo || 'https://checkout.ticto.app/OD8AA1433',
    pack3: window._checkoutUrlPack3 || 'https://checkout.ticto.app/O2B7D2FC2',
  };
  var baseUrl = checkoutUrls[productType] || checkoutUrls.mp3;

  // Pixel: InitiateCheckout
  if (typeof fbq !== 'undefined') {
    var isPackage = (productType === 'video' || productType === 'pack3');
    fbq('track', 'InitiateCheckout', {
      value:        isPackage ? 39.90 : 19.90,
      currency:     'BRL',
      content_name: isPackage ? 'Pacote 3 Músicas' : 'MP3 Completo',
      content_ids:  [productType],
      num_items:    isPackage ? 3 : 1,
    });
  }

  try {
    var url = new URL(baseUrl);
    if (_orderId) url.searchParams.set('utm_campaign', _orderId); // ID interno do pedido — NÃO trocar, backend usa isso pra casar o webhook
    if (email)    url.searchParams.set('email', email);
    // Repassa a UTM real do anúncio pra Ticto/Utmify (sem sobrescrever utm_campaign acima)
    if (_adUtms.utm_source)  url.searchParams.set('utm_source', _adUtms.utm_source);
    if (_adUtms.utm_medium)  url.searchParams.set('utm_medium', _adUtms.utm_medium);
    if (_adUtms.utm_content) url.searchParams.set('utm_content', _adUtms.utm_content);
    if (_adUtms.utm_term)    url.searchParams.set('utm_term', _adUtms.utm_term);
    window.open(url.toString(), '_blank');
  } catch(_) {
    window.open(baseUrl, '_blank');
  }
}

// ─── Criar música para outra pessoa (volta ao quiz do zero) ───
var btnCreateAnother = document.getElementById('btnCreateAnother');
if (btnCreateAnother) {
  btnCreateAnother.addEventListener('click', function() {
    if (previewSection) previewSection.classList.add('hidden');
    var p30 = document.getElementById('post30Cta');
    if (p30) p30.style.display = 'none';
    if (audioEl) { audioEl.pause(); audioEl.src = ''; }
    _orderId = null;
    _previewUrl = null;
    if (typeof window._resetQuiz === 'function') window._resetQuiz();
  });
}

if (buyBtnMp3) buyBtnMp3.addEventListener('click', function() { openCheckout('mp3'); });
if (buyBtnPack3) buyBtnPack3.addEventListener('click', function() { openCheckout('pack3'); });

// ─── Vídeo com Homenagem: antes do checkout, coleta briefing + upload numa página separada ───
if (buyBtnVideo) buyBtnVideo.addEventListener('click', function() {
  if (!window._videoServiceUrl) {
    // Serviço de vídeo ainda não configurado -- cai no checkout direto (comportamento antigo)
    openCheckout('video');
    return;
  }

  var nome    = (document.getElementById('nomeDestinatario') || {value:''}).value;
  var relacao = (document.getElementById('relacao') || {value:''}).value;
  var memoria = (document.getElementById('memoria') || {value:''}).value;
  var gEl     = document.querySelector('input[name="genero"]:checked');
  var genero  = gEl ? gEl.value : '';
  var vozEl   = document.querySelector('input[name="voz"]:checked');
  var voz     = vozEl ? vozEl.value : 'feminino';
  var email   = (document.getElementById('emailEntrega') || {value:''}).value;

  if (typeof fbq !== 'undefined') {
    fbq('track', 'InitiateCheckout', {
      value: 29.90, currency: 'BRL', content_name: 'Vídeo com Homenagem', content_ids: ['video'],
    });
  }

  var params = new URLSearchParams({
    nome: nome, relacao: relacao, memoria: memoria, genero: genero, voz: voz, email: email,
  });
  window.open(window._videoServiceUrl + '?' + params.toString(), '_blank');
});

// ─── Links → scroll para formulário ───
document.querySelectorAll('a[href="#criar"]').forEach(function(link) {
  link.addEventListener('click', function(e) {
    e.preventDefault();
    var el = document.getElementById('criar');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  });
});

// ─── Esconder botão flutuante quando botão principal estiver visível ───
var floatCta = document.getElementById('floatCta');
var mainBtn  = document.getElementById('generateBtn');
function checkFloat() {
  if (!mainBtn || !floatCta) return;
  var r = mainBtn.getBoundingClientRect();
  floatCta.style.display = (r.top >= 0 && r.bottom <= window.innerHeight) ? 'none' : 'flex';
}
window.addEventListener('scroll', checkFloat, { passive: true });
checkFloat();

// ─── Carregar URLs de checkout do backend ───
fetch(API_BASE + '/api/config')
  .then(function(r) { return r.json(); })
  .then(function(cfg) {
    if (cfg.checkoutUrlMp3)   window._checkoutUrlMp3   = cfg.checkoutUrlMp3;
    if (cfg.checkoutUrlVideo) window._checkoutUrlVideo = cfg.checkoutUrlVideo;
    if (cfg.checkoutUrlPack3) window._checkoutUrlPack3 = cfg.checkoutUrlPack3;
    if (cfg.videoServiceUrl)  window._videoServiceUrl  = cfg.videoServiceUrl;
  })
  .catch(function() {});
