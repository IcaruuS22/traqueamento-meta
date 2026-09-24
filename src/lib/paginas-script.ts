import { DOMINIOS_CHECKOUT, REGRAS_CAMPO } from '@/lib/paginas-web';

/**
 * O JavaScript servido em `/t.js?k=CHAVE` — a tag única que o dono da
 * página cola no WordPress, no Lovable, no projeto da Vercel ou no HTML
 * próprio.
 *
 * O que ele faz sozinho, sem configuração:
 *
 *  - dá um id ao visitante (`_trk_vid`, cookie de primeira parte com
 *    cópia no localStorage) e manda PageView a cada página vista,
 *    inclusive nas trocas de rota de SPA (Lovable, Next, React Router);
 *  - carrega o pixel da Meta do cliente e dispara cada evento no pixel e
 *    no servidor com o MESMO `eventID`, para a Meta contar uma vez só —
 *    servidor primeiro, pixel depois (ver `evento`);
 *  - captura qualquer `<form>` enviado que tenha e-mail ou telefone e
 *    manda como Lead — o servidor grava o lead no banco do cliente e
 *    dispara o evento na Conversions API (o rastreio não fala com CRM);
 *  - reconhece link de checkout (Hotmart, Kiwify, Eduzz...), acrescenta
 *    o id do visitante na URL (`sck`) e dispara InitiateCheckout no
 *    clique. É o `sck` que liga a venda do webhook à visita;
 *  - com a opção ligada no painel, manda ViewContent uma vez por página
 *    quando o visitante rola até a porcentagem escolhida.
 *
 * E uma API para o resto: `trk('lead', {...})`, `trk('checkout')`,
 * `trk('purchase', {order_id, value})`, `trk('view_content')`.
 *
 * Por que texto e não uma função compilada: o código roda no site do
 * cliente, fora do build do Next. Escrito à mão em ES5, sem crase e sem
 * dependência, ele funciona em qualquer navegador que a página atenda e
 * não carrega nada do bundle do painel junto. A configuração entra num
 * único ponto (`CONFIG`), como JSON.
 *
 * As regras de campo são as mesmas de `classificaCampo`, injetadas de
 * `paginas-web.ts` — os testes de lá valem para cá.
 */

export const VERSAO_SCRIPT = '1';

export type ConfigScript = {
  /** URL absoluta de `/api/rastreio/coleta`. */
  endpoint: string;
  /** `site_key` pública do site. */
  chave: string;
  /** Pixel do cliente. `null` = só servidor, nenhum pixel no navegador. */
  pixel: string | null;
  /**
   * ViewContent ao rolar: porcentagem da página vista que dispara o
   * evento, uma vez por página. 0 ou ausente = desligado.
   */
  rolagem?: number;
};

const MARCADOR = '/*__CONFIG__*/null';

const FONTE = String.raw`(function (w, d) {
  'use strict';
  if (w.__trk) return;
  var C = /*__CONFIG__*/null;
  var eu = d.currentScript;
  var src = (eu && eu.src) || '';
  var semPixel = (eu && eu.getAttribute('data-pixel') === '0') || /[?&]pixel=0(&|$)/.test(src);
  var depura = (eu && eu.hasAttribute('data-debug')) || /[?&]trk_debug=1/.test(location.search);
  w.__trk = { versao: C.versao };

  function log() {
    if (depura && w.console) console.log.apply(console, ['[trk]'].concat([].slice.call(arguments)));
  }

  /* ---------- cookies e armazenamento ---------- */

  function leCookie(n) {
    var p = d.cookie ? d.cookie.split('; ') : [];
    for (var i = 0; i < p.length; i++) {
      var k = p[i].indexOf('=');
      if (p[i].slice(0, k) === n) {
        try { return decodeURIComponent(p[i].slice(k + 1)); } catch (e) { return null; }
      }
    }
    return null;
  }

  // Domínio mais alto que aceita cookie (www.site.com.br -> site.com.br),
  // o mesmo que o pixel usa: o visitante continua o mesmo entre
  // subdomínios da página.
  var RAIZ = (function () {
    var host = location.hostname;
    if (!host || /^[0-9.:]+$/.test(host)) return null;
    var h = host.split('.');
    for (var i = h.length - 2; i >= 0; i--) {
      var dom = h.slice(i).join('.');
      d.cookie = '_trk_t=1;path=/;domain=' + dom + ';SameSite=Lax';
      if (leCookie('_trk_t')) {
        d.cookie = '_trk_t=;path=/;domain=' + dom + ';max-age=0';
        return dom;
      }
    }
    return null;
  })();

  function gravaCookie(n, v, dias) {
    var s = n + '=' + encodeURIComponent(v) + ';path=/;max-age=' + Math.round(dias * 86400) + ';SameSite=Lax';
    if (RAIZ) s += ';domain=' + RAIZ;
    if (location.protocol === 'https:') s += ';Secure';
    d.cookie = s;
  }

  function guarda(k, v) {
    try {
      if (v === undefined) return w.localStorage.getItem(k);
      w.localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }

  function hex(n) {
    var a = new Uint8Array(n), s = '';
    if (w.crypto && w.crypto.getRandomValues) w.crypto.getRandomValues(a);
    else for (var j = 0; j < n; j++) a[j] = Math.floor(Math.random() * 256);
    for (var i = 0; i < n; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }

  /* ---------- visitante ---------- */

  var RX_VID = /^[a-f0-9]{32}$/;
  var vid = leCookie('_trk_vid');
  if (!vid || !RX_VID.test(vid)) {
    vid = guarda('_trk_vid');
    if (!vid || !RX_VID.test(vid)) vid = hex(16);
  }
  gravaCookie('_trk_vid', vid, 395);
  guarda('_trk_vid', vid);

  var qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { qs = { get: function () { return null; } }; }

  // _fbc a partir do fbclid, no formato do pixel. Com o pixel ligado ele
  // faz o mesmo; aqui vale para quem desligou o pixel do navegador.
  var fbclid = qs.get('fbclid');
  if (fbclid && /^[A-Za-z0-9_-]{10,500}$/.test(fbclid)) {
    var fbcAtual = leCookie('_fbc');
    if (!fbcAtual || fbcAtual.split('.').slice(3).join('.') !== fbclid) {
      gravaCookie('_fbc', 'fb.1.' + new Date().getTime() + '.' + fbclid, 90);
    }
  }

  /* ---------- pixel ---------- */

  var pixel = !semPixel && C.pixel ? C.pixel : null;
  if (pixel) {
    if (!w.fbq) {
      var n = (w.fbq = function () {
        if (n.callMethod) n.callMethod.apply(n, arguments);
        else n.queue.push(arguments);
      });
      if (!w._fbq) w._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      var t = d.createElement('script');
      t.async = true;
      t.src = 'https://connect.facebook.net/en_US/fbevents.js';
      (d.head || d.documentElement).appendChild(t);
    }
    // O pixel dispara PageView sozinho a cada pushState. Quem manda o
    // PageView de SPA é este script, com o eventID que o servidor também
    // recebe; o automático sairia sem eventID e contaria em dobro.
    w.fbq.disablePushState = true;
    w.fbq('init', pixel, { external_id: vid });
  }

  // Correspondência avançada manual. Sem ela, só a cópia do servidor
  // levaria e-mail e telefone — e é justamente a cópia que a Meta descarta
  // na deduplicação quando o navegador chega primeiro. O pixel criptografa
  // (SHA-256) antes de enviar; a normalização segue a do servidor
  // (montaUserData) para os dois lados baterem. Fica só na memória da
  // página: nada de dado pessoal gravado no navegador do visitante.
  var PONTUACAO = /[0-9!-\/:-@\[-\x60{-~]/g;
  function identificaNoPixel(p) {
    if (!pixel || !w.fbq) return;
    var u = { external_id: vid };
    if (p.email) u.em = p.email.toLowerCase();
    if (p.telefone) u.ph = p.telefone.indexOf('55') === 0 ? p.telefone : '55' + p.telefone;
    var nome = String(p.primeiro_nome || '').trim();
    var sobrenome = String(p.sobrenome || '').trim();
    if (!nome && p.nome) {
      var partes = String(p.nome).trim().split(/\s+/);
      nome = partes.shift() || '';
      if (!sobrenome) sobrenome = partes.join(' ');
    }
    var fn = nome.toLowerCase().replace(PONTUACAO, '').replace(/\s+/g, ' ').trim();
    var ln = sobrenome.toLowerCase().replace(PONTUACAO, '').replace(/\s+/g, ' ').trim();
    var ct = String(p.cidade || '').toLowerCase().replace(PONTUACAO, '').replace(/\s+/g, '');
    var st = String(p.estado || '').toLowerCase().trim();
    var zp = String(p.cep || '').replace(/\D/g, '');
    if (fn) u.fn = fn;
    if (ln) u.ln = ln;
    if (ct) u.ct = ct;
    if (/^[a-z]{2}$/.test(st)) u.st = st;
    if (zp.length >= 5 && zp.length <= 9) u.zp = zp;
    if (u.ph) u.country = 'br';
    try { w.fbq('init', pixel, u); } catch (e) {}
  }

  function noPixel(nome, dados, id) {
    if (!pixel || !w.fbq) return;
    try { w.fbq('trackSingle', pixel, nome, dados || {}, { eventID: id }); } catch (e) {}
  }

  /* ---------- envio ---------- */

  // text/plain não dispara preflight de CORS. sendBeacon e fetch com
  // keepalive sobrevivem à troca de página — o Lead de um formulário que
  // redireciona e o InitiateCheckout do clique que sai do site dependem
  // disso.
  function porFetch(s, depois) {
    fetch(C.endpoint, { method: 'POST', body: s, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } })
      .then(function () { depois(); }, function () { depois(); });
  }

  // "depois" roda quando a coleta responde — e ela só responde depois de
  // entregar o evento à Conversions API. Sem quem esperar (sem pixel), o
  // sendBeacon basta.
  function envia(corpo, depois) {
    var s = JSON.stringify(corpo);
    log('envia', corpo);
    if (depois && w.fetch) {
      try { return porFetch(s, depois); } catch (e) {}
    }
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(C.endpoint, new Blob([s], { type: 'text/plain' }))) return depois && depois();
    } catch (e) {}
    try { porFetch(s, depois || function () {}); } catch (e) { if (depois) depois(); }
  }

  // Na primeira página o _fbp ainda não existe: o pixel o cria quando
  // termina de carregar. O PageView espera até 2 s por ele.
  function quandoFbp(fn, tentativa) {
    tentativa = tentativa || 0;
    if (!pixel || leCookie('_fbp') || tentativa >= 8) return fn();
    setTimeout(function () { quandoFbp(fn, tentativa + 1); }, 250);
  }

  var referrer = d.referrer || null;

  // Quanto o pixel espera a coleta confirmar antes de disparar mesmo assim.
  var ESPERA_SERVIDOR = 4000;

  // Servidor primeiro, pixel depois. Com o mesmo eventID nas duas cópias,
  // a Meta fica com a que chega primeiro e descarta a outra — e a do
  // servidor é a completa (e-mail, telefone e nome do lead já conhecido,
  // fbc, fbp, IP). Se a coleta demorar ou falhar, o pixel sai mesmo assim:
  // uma cópia do navegador vale mais que nenhuma.
  function evento(nome, extra, id, espera) {
    id = id || 'site_' + nome.toLowerCase() + '_' + hex(12);
    var corpo = { k: C.chave, ev: nome, id: id, vid: vid, url: location.href, ref: referrer };
    referrer = null;
    if (extra) for (var c in extra) if (Object.prototype.hasOwnProperty.call(extra, c)) corpo[c] = extra[c];
    var disparado = false;
    var dispara = function () {
      if (disparado) return;
      disparado = true;
      noPixel(nome, extra && extra.cd, id);
    };
    var manda = function () {
      corpo.fbc = leCookie('_fbc');
      corpo.fbp = leCookie('_fbp');
      if (!pixel || !w.fbq) return envia(corpo);
      envia(corpo, dispara);
      setTimeout(dispara, ESPERA_SERVIDOR);
    };
    if (espera) quandoFbp(manda);
    else manda();
    return id;
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v == null ? '' : v).replace(/[^\d,.-]/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var x = Number(s);
    return isFinite(x) ? x : null;
  }

  function personalizados(o) {
    o = o || {};
    var c = {};
    var v = num(o.value != null ? o.value : o.valor);
    if (v != null) {
      c.value = v;
      c.currency = String(o.currency || o.moeda || 'BRL').toUpperCase();
    }
    if (o.content_name || o.produto) c.content_name = String(o.content_name || o.produto).slice(0, 200);
    if (o.order_id || o.pedido) c.order_id = String(o.order_id || o.pedido).slice(0, 120);
    return c;
  }

  /* ---------- PageView, inclusive em SPA ---------- */

  var ultimaUrl = null;
  var vcEnviado = false;
  function pageview() {
    var u = location.href.split('#')[0];
    if (u === ultimaUrl) return;
    ultimaUrl = u;
    vcEnviado = false;
    evento('PageView', null, null, true);
  }

  ['pushState', 'replaceState'].forEach(function (m) {
    var original = history[m];
    if (typeof original !== 'function') return;
    history[m] = function () {
      var r = original.apply(this, arguments);
      setTimeout(pageview, 0);
      return r;
    };
  });
  w.addEventListener('popstate', function () { setTimeout(pageview, 0); });

  /* ---------- ViewContent ao rolar ---------- */

  function viewContent(dados) {
    vcEnviado = true;
    return evento('ViewContent', { cd: personalizados(dados) });
  }

  // Uma vez por página (a troca de rota zera). Só conta rolagem de
  // verdade: página curta, que cabe na tela, não dispara sozinha.
  var ROLAGEM = C.rolagem > 0 ? C.rolagem : 0;
  var rolagemAgendada = false;
  function confereRolagem() {
    rolagemAgendada = false;
    if (vcEnviado) return;
    var de = d.documentElement || {};
    var alto = Math.max((d.body && d.body.scrollHeight) || 0, de.scrollHeight || 0);
    if (!alto) return;
    var topo = w.pageYOffset || de.scrollTop || 0;
    var visto = topo + (w.innerHeight || de.clientHeight || 0);
    if (topo > 0 && (visto / alto) * 100 >= ROLAGEM) viewContent({ content_name: d.title });
  }
  if (ROLAGEM) {
    w.addEventListener('scroll', function () {
      if (vcEnviado || rolagemAgendada) return;
      rolagemAgendada = true;
      setTimeout(confereRolagem, 200);
    }, { passive: true });
  }

  /* ---------- checkout ---------- */

  var CK = C.checkout || [];
  function ehCheckout(a) {
    if (!a || !a.href || !a.getAttribute) return false;
    if (a.hasAttribute('data-trk-checkout')) return true;
    var h = (a.hostname || '').toLowerCase();
    if (!h || h === location.hostname) return false;
    for (var i = 0; i < CK.length; i++) {
      if (h === CK[i] || h.slice(-CK[i].length - 1) === '.' + CK[i]) return true;
    }
    return /^(checkout|pay|pagamento|seguro)\./.test(h);
  }

  // O id do visitante vai no primeiro campo livre de rastreio que o link
  // ainda não usa. sck e src são lidos por Hotmart e Kiwify; s1 só pela
  // Kiwify. Um sck que o dono da página já usa ("instagram") fica.
  var LIVRES = ['sck', 'src', 's1'];
  function decora(a) {
    if (a.getAttribute('data-trk-vid') === vid) return;
    try {
      var u = new URL(a.href, location.href);
      var tem = false;
      for (var i = 0; i < LIVRES.length; i++) if (u.searchParams.get(LIVRES[i]) === vid) tem = true;
      if (!tem) {
        for (var j = 0; j < LIVRES.length; j++) {
          if (!u.searchParams.get(LIVRES[j])) { u.searchParams.set(LIVRES[j], vid); break; }
        }
      }
      // As UTMs da página seguem para o checkout: é o que faz o
      // relatório da própria plataforma bater com o do painel.
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
        var v = qs.get(k);
        if (v && !u.searchParams.get(k)) u.searchParams.set(k, v);
      });
      a.href = u.toString();
      a.setAttribute('data-trk-vid', vid);
    } catch (e) {}
  }

  function decoraTudo() {
    var l = d.getElementsByTagName('a');
    for (var i = 0; i < l.length; i++) if (ehCheckout(l[i])) decora(l[i]);
  }

  var agendado = false;
  function agenda() {
    if (agendado) return;
    agendado = true;
    setTimeout(function () { agendado = false; decoraTudo(); }, 400);
  }

  var ultimoCheckout = 0;
  d.addEventListener('click', function (e) {
    var alvo = e.target;
    var a = alvo && alvo.closest ? alvo.closest('a') : null;
    if (!ehCheckout(a)) return;
    decora(a);
    var agora = new Date().getTime();
    if (agora - ultimoCheckout < 3000) return;
    ultimoCheckout = agora;
    evento('InitiateCheckout', {
      cd: personalizados({
        value: a.getAttribute('data-trk-valor'),
        currency: a.getAttribute('data-trk-moeda'),
        content_name: a.getAttribute('data-trk-produto')
      })
    });
  }, true);

  /* ---------- formulários ---------- */

  var REGRAS = [];
  for (var r = 0; r < C.regras.length; r++) REGRAS.push([C.regras[r][0], new RegExp(C.regras[r][1], 'i')]);
  var SEM_DADO = { hidden: 1, password: 1, checkbox: 1, radio: 1, submit: 1, button: 1, file: 1, reset: 1, image: 1, range: 1, color: 1 };
  var RX_ARMADILHA = /honeypot|_gotcha|^hp[_-]|bot[_-]?field/i;

  function rotulo(el) {
    var t = '';
    try {
      if (el.id && w.CSS && w.CSS.escape) {
        var l = d.querySelector('label[for="' + w.CSS.escape(el.id) + '"]');
        if (l) t = l.textContent || '';
      }
      if (!t && el.closest) {
        var p = el.closest('label');
        if (p) t = p.textContent || '';
      }
    } catch (e) {}
    return (t || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 120);
  }

  function classifica(el) {
    var forcado = el.getAttribute('data-trk-campo');
    if (forcado) return forcado;
    var tipo = String(el.type || '').toLowerCase();
    if (tipo === 'email') return 'email';
    if (tipo === 'tel') return 'telefone';
    if (SEM_DADO[tipo]) return null;
    var x = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), rotulo(el)]
      .filter(Boolean).join(' ').toLowerCase();
    if (!x) return null;
    for (var i = 0; i < REGRAS.length; i++) if (REGRAS[i][1].test(x)) return REGRAS[i][0];
    return null;
  }

  function leFormulario(form) {
    var dados = {}, armadilha = false, senha = false, els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (String(el.type || '').toLowerCase() === 'password') senha = true;
      var v = el.value;
      if (typeof v !== 'string' || !v.trim()) continue;
      if (RX_ARMADILHA.test(el.name || el.id || '')) { armadilha = true; continue; }
      var tipo = classifica(el);
      if (!tipo || tipo === 'ignorar' || dados[tipo]) continue;
      dados[tipo] = v.trim().slice(0, 200);
    }
    return { dados: dados, armadilha: armadilha, senha: senha };
  }

  var ultimoLead = '', ultimoLeadEm = 0;
  function lead(dados) {
    dados = dados || {};
    var tel = String(dados.telefone || dados.phone || dados.whatsapp || '').replace(/\D/g, '');
    var em = String(dados.email || '').trim();
    if (tel.length < 10 && em.indexOf('@') < 1) { log('lead sem e-mail nem telefone: ignorado'); return; }
    var chave = em + '|' + tel, agora = new Date().getTime();
    if (chave === ultimoLead && agora - ultimoLeadEm < 5000) return;
    ultimoLead = chave;
    ultimoLeadEm = agora;
    var pessoa = {
      email: em || null,
      telefone: tel || null,
      nome: dados.nome || dados.name || null,
      primeiro_nome: dados.primeiro_nome || null,
      sobrenome: dados.sobrenome || null,
      cidade: dados.cidade || null,
      estado: dados.estado || null,
      cep: dados.cep || null
    };
    // Antes do evento: o Lead do pixel já sai com os dados da pessoa, e
    // os eventos seguintes desta página também.
    identificaNoPixel(pessoa);
    return evento('Lead', { dados: pessoa });
  }

  // Fase de captura: roda antes do handler do construtor de página, que
  // muitas vezes cancela o envio para mandar por fetch.
  d.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.tagName !== 'FORM' || f.hasAttribute('data-trk-ignore')) return;
    if (f.checkValidity && !f.checkValidity()) return;
    var lido = leFormulario(f);
    // Formulário com senha é login ou cadastro de área de membros, não
    // lead; campo-armadilha preenchido é robô.
    if (lido.senha || lido.armadilha) return;
    lead(lido.dados);
  }, true);

  /* ---------- compra ---------- */

  function compra(o) {
    o = o || {};
    var pedido = String(o.order_id || o.pedido || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80);
    // Recarregar a página de obrigado não conta a venda de novo.
    if (pedido && guarda('_trk_compra_' + pedido)) return;
    if (pedido) guarda('_trk_compra_' + pedido, '1');
    return evento('Purchase', { cd: personalizados(o) }, pedido ? 'site_purchase_' + pedido : null);
  }

  /* ---------- API pública ---------- */

  function api(comando, dados) {
    switch (String(comando || '').toLowerCase()) {
      case 'lead': return lead(dados);
      case 'checkout':
      case 'initiatecheckout': return evento('InitiateCheckout', { cd: personalizados(dados) });
      case 'view_content':
      case 'viewcontent': return viewContent(dados);
      case 'purchase':
      case 'compra': return compra(dados);
      case 'pageview': ultimaUrl = null; return pageview();
      case 'visitante': return vid;
    }
    log('comando desconhecido', comando);
  }

  var fila = (w.trk && w.trk.q) || [];
  w.trk = function () { return api.apply(null, arguments); };
  w.trk.visitante = vid;

  pageview();
  decoraTudo();
  if (w.MutationObserver) new MutationObserver(agenda).observe(d.documentElement, { childList: true, subtree: true });
  for (var q = 0; q < fila.length; q++) api.apply(null, fila[q]);
})(window, document);
`;

/** O script pronto para um site. */
export function montaScript(c: ConfigScript): string {
  const config = JSON.stringify({
    versao: VERSAO_SCRIPT,
    endpoint: c.endpoint,
    chave: c.chave,
    pixel: c.pixel,
    rolagem: c.rolagem && c.rolagem > 0 && c.rolagem <= 100 ? Math.round(c.rolagem) : 0,
    regras: REGRAS_CAMPO,
    checkout: DOMINIOS_CHECKOUT,
  });
  // Função no replace: um `$` no JSON não vira padrão de substituição.
  return FONTE.replace(MARCADOR, () => config);
}

/** Resposta para chave desconhecida ou site desativado: não quebra a página. */
export function scriptVazio(motivo: string): string {
  return `/* trk: ${motivo.replace(/\*\//g, '')} */\nwindow.trk=window.trk||function(){};\n`;
}
