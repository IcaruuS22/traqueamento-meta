import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import {
  classificaCampo,
  contatoDoFormulario,
  dadosPersonalizados,
  dominioPermitido,
  ehEventIdPagina,
  eventIdDaCompra,
  leCompra,
  limpaUrl,
  montaUserData,
  normalizaDominios,
  numeroMonetario,
  origemDaUrl,
} from '../src/lib/paginas-web';
import { montaScript, scriptVazio } from '../src/lib/paginas-script';

/**
 * Testes do rastreio de páginas de vendas.
 *
 * Cobrem o que erra calado: a Meta aceita hash de e-mail com maiúscula,
 * venda em centavos e visitante que não existe sem devolver erro nenhum.
 * O script do navegador roda aqui dentro de um `vm` com um DOM mínimo de
 * mentira — o bastante para ver o que ele manda para a coleta.
 */

const VID = '0123456789abcdef0123456789abcdef';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('domínios do site', () => {
  test('normaliza URL colada, www e separadores', () => {
    const r = normalizaDominios('https://www.Site.com.br/oferta?x=1, lp.site.com.br; ruim_!\nsite.com.br');
    assert.deepEqual(r.dominios, ['site.com.br', 'lp.site.com.br']);
    assert.deepEqual(r.invalidos, ['ruim_!']);
  });

  test('libera o domínio e subdomínios, e nada mais', () => {
    const lista = ['site.com.br'];
    assert.equal(dominioPermitido('site.com.br', lista), true);
    assert.equal(dominioPermitido('www.site.com.br', lista), true);
    assert.equal(dominioPermitido('outrosite.com.br', lista), false);
    assert.equal(dominioPermitido('site.com.br.golpe.com', lista), false);
    assert.equal(dominioPermitido(null, lista), false);
    assert.equal(dominioPermitido('site.com.br', []), false);
  });
});

describe('classificação de campos de formulário', () => {
  test('ignora empresa e documentos antes de olhar nome e telefone', () => {
    assert.equal(classificaCampo({ name: 'nome_empresa' }), 'ignorar');
    assert.equal(classificaCampo({ name: 'cpf' }), 'ignorar');
  });

  test('reconhece os tipos de campo comuns', () => {
    assert.equal(classificaCampo({ type: 'email', name: 'x' }), 'email');
    assert.equal(classificaCampo({ type: 'tel' }), 'telefone');
    assert.equal(classificaCampo({ name: 'whatsapp' }), 'telefone');
    assert.equal(classificaCampo({ name: 'tel' }), 'telefone');
    assert.equal(classificaCampo({ name: 'sobrenome' }), 'sobrenome');
    assert.equal(classificaCampo({ name: 'first_name' }), 'primeiro_nome');
    assert.equal(classificaCampo({ name: 'full_name' }), 'nome');
    assert.equal(classificaCampo({ name: 'uf' }), 'estado');
    assert.equal(classificaCampo({ name: 'cep' }), 'cep');
    assert.equal(classificaCampo({ placeholder: 'Seu melhor e-mail' }), 'email');
  });

  test('não confunde palavra que só contém "tel" e pula campo escondido', () => {
    assert.equal(classificaCampo({ name: 'hotel' }), null);
    assert.equal(classificaCampo({ type: 'hidden', name: 'email' }), null);
  });
});

describe('contato do formulário', () => {
  test('exige e-mail ou telefone com DDD', () => {
    assert.equal(contatoDoFormulario({ email: 'sem-arroba', telefone: '99998888' }), null);
    assert.equal(contatoDoFormulario({}), null);
  });

  test('normaliza telefone, nome e UF', () => {
    const c = contatoDoFormulario({ telefone: '(11) 99999-8888', nome: 'Maria da Silva', estado: 'São Paulo' });
    assert.equal(c?.telefone, '5511999998888');
    assert.equal(c?.primeiro_nome, 'Maria');
    assert.equal(c?.sobrenome, 'da Silva');
    assert.equal(c?.estado, 'sp');
  });

  test('telefone curto demais some, o e-mail segura o lead', () => {
    const c = contatoDoFormulario({ email: 'A@B.com', telefone: '123' });
    assert.equal(c?.telefone, null);
    assert.equal(c?.email, 'a@b.com');
  });
});

describe('valores e ids', () => {
  test('lê dinheiro nos formatos brasileiro e americano', () => {
    assert.equal(numeroMonetario('97,00'), 97);
    assert.equal(numeroMonetario('97.00'), 97);
    assert.equal(numeroMonetario('1.297,90'), 1297.9);
    assert.equal(numeroMonetario('R$ 49,90'), 49.9);
    assert.equal(numeroMonetario('abc'), null);
  });

  test('event_id da compra é o mesmo venha do webhook ou da página', () => {
    assert.equal(eventIdDaCompra('A 1/2'), 'site_purchase_A12');
    assert.equal(eventIdDaCompra(''), null);
    assert.equal(ehEventIdPagina('site_purchase_A12'), true);
    // O formato do fluxo do Kommo não passa: os dois dividem a coluna UNIQUE.
    assert.equal(ehEventIdPagina('purchase_12345'), false);
  });

  test('custom_data só com o que veio', () => {
    assert.deepEqual(dadosPersonalizados({ valor: '497,00', produto: 'Curso' }), {
      value: 497,
      currency: 'BRL',
      content_name: 'Curso',
    });
    assert.deepEqual(dadosPersonalizados({ value: -5 }), {});
  });
});

describe('URL da página', () => {
  test('origem: UTMs, fbclid e ids da Meta, sem macro não substituída', () => {
    const o = origemDaUrl(
      'https://s.com/?utm_source=fb&utm_campaign=c1&fbclid=AbCdEf123456&ad_id={{ad.id}}&utm_id=120200000000',
    );
    assert.deepEqual(o.utm, { source: 'fb', campaign: 'c1' });
    assert.equal(o.fbclid, 'AbCdEf123456');
    assert.equal(o.meta_ad_id, null);
    assert.equal(o.meta_campaign_id, '120200000000');
    assert.deepEqual(origemDaUrl('não é url').utm, {});
  });

  test('tira dado pessoal e fragmento da URL', () => {
    assert.equal(limpaUrl('https://s.com/obrigado?email=a@b.com&nome=Ana&order=1#topo'), 'https://s.com/obrigado?order=1');
    assert.equal(limpaUrl('javascript:alert(1)'), null);
  });
});

describe('user_data da Meta', () => {
  test('hash dos dados pessoais, identificadores do navegador em claro', () => {
    const u = montaUserData({
      email: ' A@B.com ',
      telefone: '5511999998888',
      external_id: VID,
      fbc: 'lixo',
      fbp: 'fb.1.1700000000000.123',
      ip: '1.2.3.4',
    });
    assert.deepEqual(u.em, [sha('a@b.com')]);
    assert.deepEqual(u.ph, [sha('5511999998888')]);
    assert.deepEqual(u.external_id, [sha(VID)]);
    assert.equal(u.fbc, undefined);
    assert.equal(u.fbp, 'fb.1.1700000000000.123');
    assert.equal(u.client_ip_address, '1.2.3.4');
    // Campo vazio não vai nem como hash de texto vazio.
    assert.equal('fn' in u, false);
  });
});

describe('webhooks de compra', () => {
  const hotmart = (evento: string, origem: Record<string, string> = { sck: VID }) => ({
    event: evento,
    data: {
      purchase: { transaction: 'HP123', status: 'APPROVED', price: { value: 497, currency_value: 'BRL' }, origin: origem },
      buyer: { email: 'Maria@Ex.com', checkout_phone: '11999998888', name: 'Maria Silva' },
      product: { name: 'Curso' },
    },
  });

  test('Hotmart aprovada', () => {
    const c = leCompra('hotmart', hotmart('PURCHASE_APPROVED'));
    assert.equal(c?.situacao, 'aprovada');
    assert.equal(c?.pedido, 'HP123');
    assert.equal(c?.valor, 497);
    assert.equal(c?.email, 'maria@ex.com');
    assert.equal(c?.telefone, '5511999998888');
    assert.equal(c?.visitante, VID);
    assert.equal(c?.produto, 'Curso');
  });

  test('Hotmart: sck usado pelo dono da página não vira visitante', () => {
    const c = leCompra('hotmart', hotmart('PURCHASE_APPROVED', { sck: 'instagram', xcod: VID }));
    assert.equal(c?.visitante, VID);
    assert.equal(leCompra('hotmart', hotmart('PURCHASE_APPROVED', { sck: 'instagram' }))?.visitante, null);
  });

  test('Hotmart reembolso e corpo sem transação', () => {
    assert.equal(leCompra('hotmart', hotmart('PURCHASE_REFUNDED'))?.situacao, 'reembolsada');
    assert.equal(leCompra('hotmart', { event: 'PURCHASE_APPROVED', data: {} }), null);
  });

  test('Kiwify: centavos, corpo embrulhado e UTMs', () => {
    const pedido = {
      order_id: 'K1',
      order_status: 'paid',
      Commissions: { charge_amount: '9700', currency: 'BRL' },
      Customer: { email: 'joao@ex.com', mobile: '+5511988887777', full_name: 'João Souza' },
      TrackingParameters: { src: VID, utm_campaign: 'camp' },
      Product: { product_name: 'Mentoria' },
    };
    for (const corpo of [pedido, { order: pedido }]) {
      const c = leCompra('kiwify', corpo);
      assert.equal(c?.situacao, 'aprovada');
      assert.equal(c?.valor, 97);
      assert.equal(c?.telefone, '5511988887777');
      assert.equal(c?.visitante, VID);
      assert.equal(c?.utm.campaign, 'camp');
    }
    assert.equal(leCompra('kiwify', { ...pedido, order_status: 'refunded' })?.situacao, 'reembolsada');
  });

  test('genérico: sem status é venda, pendente não é', () => {
    const c = leCompra('generico', { order_id: 'G1', value: '1.297,90', email: 'a@b.com', phone: '(11) 97777-6666' });
    assert.equal(c?.situacao, 'aprovada');
    assert.equal(c?.valor, 1297.9);
    assert.equal(c?.telefone, '5511977776666');
    assert.equal(leCompra('generico', { order_id: 'G2', status: 'pending' })?.situacao, 'outra');
    assert.equal(leCompra('generico', { value: 10 }), null);
  });
});

/* ------------------------------------------------------------------ */
/* Script do navegador                                                 */
/* ------------------------------------------------------------------ */

type Beacon = { url: string; corpo: Promise<Record<string, unknown>> };

/** Roda o script num DOM mínimo e devolve o que dá para inspecionar. */
function rodaScript(opcoes: {
  pixel?: string | null;
  href?: string;
  cookies?: Record<string, string>;
  currentScript?: unknown;
  rolagem?: number;
  /** Como a coleta responde ao fetch: na hora (padrão), com erro ou quando o teste mandar. */
  coleta?: 'ok' | 'falha' | 'pendente';
  antes?: (janela: Record<string, unknown>) => void;
} = {}) {
  const href = opcoes.href ?? 'https://www.site.com.br/?utm_campaign=camp1';
  const url = new URL(href);
  const jar = new Map<string, string>(Object.entries(opcoes.cookies ?? {}));
  const armazenamento = new Map<string, string>();
  const ouvintes: Record<string, ((e: unknown) => void)[]> = {};
  const ouvintesJanela: Record<string, ((e: unknown) => void)[]> = {};
  const beacons: Beacon[] = [];
  const respondeColeta: (() => void)[] = [];

  const documento = {
    currentScript: opcoes.currentScript ?? null,
    referrer: '',
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(s: string) {
      const [par, ...attrs] = s.split(';');
      const i = par.indexOf('=');
      const nome = par.slice(0, i);
      const dominio = attrs.find((a) => a.startsWith('domain='))?.slice(7);
      // Sufixo público não aceita cookie, como no navegador.
      if (dominio && ['com.br', 'com', 'br'].includes(dominio)) return;
      if (attrs.includes('max-age=0')) jar.delete(nome);
      else jar.set(nome, par.slice(i + 1));
    },
    addEventListener(tipo: string, fn: (e: unknown) => void) {
      (ouvintes[tipo] ??= []).push(fn);
    },
    getElementsByTagName: () => [],
    createElement: () => ({}),
    head: { appendChild() {} },
    documentElement: {} as Record<string, unknown>,
    title: '',
  };

  const janela: Record<string, unknown> = {
    document: documento,
    location: { href, hostname: url.hostname, search: url.search, protocol: url.protocol },
    navigator: {
      sendBeacon(destino: string, blob: Blob) {
        beacons.push({ url: destino, corpo: blob.text().then((t) => JSON.parse(t)) });
        return true;
      },
    },
    history: { pushState() {}, replaceState() {} },
    localStorage: {
      getItem: (k: string) => armazenamento.get(k) ?? null,
      setItem: (k: string, v: string) => void armazenamento.set(k, String(v)),
    },
    crypto: {
      getRandomValues(a: Uint8Array) {
        for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
        return a;
      },
    },
    addEventListener(tipo: string, fn: (e: unknown) => void) {
      (ouvintesJanela[tipo] ??= []).push(fn);
    },
    fetch(destino: string, init: { body: string }) {
      beacons.push({ url: destino, corpo: Promise.resolve(JSON.parse(init.body)) });
      if (opcoes.coleta === 'falha') return Promise.reject(new TypeError('Failed to fetch'));
      if (opcoes.coleta === 'pendente') return new Promise<void>((ok) => respondeColeta.push(ok));
      return Promise.resolve({ status: 204 });
    },
    URL,
    URLSearchParams,
    Blob,
    // unref: o prazo de segurança do pixel não segura o processo de teste.
    setTimeout: (fn: () => void, ms?: number) => {
      const t = setTimeout(fn, ms);
      t.unref();
      return t;
    },
  };
  janela.window = janela;
  opcoes.antes?.(janela);

  const codigo = montaScript({
    endpoint: 'https://painel.test/api/rastreio/coleta',
    chave: 'chave123',
    pixel: opcoes.pixel ?? null,
    rolagem: opcoes.rolagem,
  });
  new vm.Script(codigo).runInContext(vm.createContext(janela));

  return {
    janela,
    jar,
    beacons,
    ouvintes,
    ouvintesJanela,
    documento,
    respondeColeta,
    trk: janela.trk as (...a: unknown[]) => unknown,
  };
}

const campo = (type: string, name: string, value: string) => ({ type, name, value, getAttribute: () => null });

describe('script da página', () => {
  test('compila e o script vazio também', () => {
    assert.doesNotThrow(() => new vm.Script(montaScript({ endpoint: 'https://x/$&', chave: 'k', pixel: '1' })));
    assert.ok(montaScript({ endpoint: 'https://x/$&', chave: 'k', pixel: null }).includes('"https://x/$&"'));
    const ctx = vm.createContext({ window: {} as Record<string, unknown> });
    new vm.Script(scriptVazio('chave */ desconhecida')).runInContext(ctx);
    assert.equal(typeof (ctx.window as Record<string, unknown>).trk, 'function');
  });

  test('PageView na carga, com visitante em cookie no domínio raiz', async () => {
    const { beacons, jar, trk } = rodaScript();
    assert.equal(beacons.length, 1);
    const pv = await beacons[0].corpo;
    assert.equal(beacons[0].url, 'https://painel.test/api/rastreio/coleta');
    assert.equal(pv.ev, 'PageView');
    assert.equal(pv.k, 'chave123');
    assert.match(String(pv.vid), /^[a-f0-9]{32}$/);
    assert.match(String(pv.id), /^site_pageview_[a-f0-9]{24}$/);
    assert.equal(jar.get('_trk_vid'), pv.vid);
    assert.equal(trk('visitante'), pv.vid);
  });

  test('mantém o visitante que já tinha cookie', async () => {
    const { beacons } = rodaScript({ cookies: { _trk_vid: VID } });
    assert.equal((await beacons[0].corpo).vid, VID);
  });

  test('processa a fila de chamadas feitas antes do script carregar', async () => {
    const { beacons } = rodaScript({
      antes: (j) => {
        const fila = function () {} as unknown as { q: unknown[] };
        fila.q = [['lead', { email: 'fila@ex.com' }]];
        j.trk = fila;
      },
    });
    assert.equal(beacons.length, 2);
    const lead = await beacons[1].corpo;
    assert.equal(lead.ev, 'Lead');
    assert.equal((lead.dados as Record<string, unknown>).email, 'fila@ex.com');
  });

  test('compra usa o event_id do pedido e não repete ao recarregar', async () => {
    const { beacons, trk } = rodaScript();
    trk('purchase', { order_id: 'PED 1', value: '1.297,90' });
    trk('purchase', { order_id: 'PED 1', value: '1.297,90' });
    assert.equal(beacons.length, 2);
    const compra = await beacons[1].corpo;
    assert.equal(compra.ev, 'Purchase');
    assert.equal(compra.id, 'site_purchase_PED1');
    assert.equal((compra.cd as Record<string, unknown>).value, 1297.9);
  });

  test('formulário vira Lead; com senha, não', async () => {
    const { beacons, ouvintes } = rodaScript();
    const form = (elementos: unknown[]) => ({
      tagName: 'FORM',
      hasAttribute: () => false,
      checkValidity: () => true,
      elements: elementos,
    });
    const envia = (f: unknown) => ouvintes.submit.forEach((fn) => fn({ target: f }));

    envia(
      form([
        campo('text', 'nome', 'Maria Silva'),
        campo('email', 'x', 'maria@ex.com'),
        campo('text', 'cpf', '123.456.789-01'),
        campo('text', 'hp_field', 'robô'),
      ]),
    );
    // Campo-armadilha preenchido: robô, nada sai.
    assert.equal(beacons.length, 1);

    envia(form([campo('text', 'nome', 'Maria Silva'), campo('email', 'x', 'maria@ex.com'), campo('text', 'cpf', '123')]));
    assert.equal(beacons.length, 2);
    const lead = await beacons[1].corpo;
    assert.equal(lead.ev, 'Lead');
    assert.deepEqual(
      { email: (lead.dados as Record<string, unknown>).email, nome: (lead.dados as Record<string, unknown>).nome },
      { email: 'maria@ex.com', nome: 'Maria Silva' },
    );

    envia(form([campo('email', 'login', 'outra@ex.com'), campo('password', 'senha', 'x')]));
    assert.equal(beacons.length, 2);
  });

  test('clique no checkout leva o visitante e as UTMs, e manda InitiateCheckout', async () => {
    const { beacons, ouvintes, trk } = rodaScript();
    const attrs: Record<string, string> = {};
    const link = {
      href: 'https://pay.hotmart.com/ABC?off=x',
      hostname: 'pay.hotmart.com',
      getAttribute: (n: string) => attrs[n] ?? null,
      hasAttribute: (n: string) => n in attrs,
      setAttribute: (n: string, v: string) => void (attrs[n] = v),
    };
    ouvintes.click.forEach((fn) => fn({ target: { closest: () => link } }));

    const u = new URL(link.href);
    assert.equal(u.searchParams.get('sck'), trk('visitante'));
    assert.equal(u.searchParams.get('utm_campaign'), 'camp1');
    assert.equal(u.searchParams.get('off'), 'x');
    assert.equal(beacons.length, 2);
    assert.equal((await beacons[1].corpo).ev, 'InitiateCheckout');
  });

  test('link comum não é checkout', () => {
    const { beacons, ouvintes } = rodaScript();
    const link = {
      href: 'https://blog.outro.com/post',
      hostname: 'blog.outro.com',
      getAttribute: () => null,
      hasAttribute: () => false,
      setAttribute() {},
    };
    ouvintes.click.forEach((fn) => fn({ target: { closest: () => link } }));
    assert.equal(link.href, 'https://blog.outro.com/post');
    assert.equal(beacons.length, 1);
  });

  const filaDoPixel = (janela: Record<string, unknown>) =>
    JSON.parse(JSON.stringify((janela.fbq as { queue: unknown[][] }).queue.map((a) => [...a])));
  const umInstante = () => new Promise((r) => setTimeout(r, 0));

  test('pixel recebe o mesmo eventID que o servidor', async () => {
    const { janela, beacons } = rodaScript({ pixel: '999', cookies: { _fbp: 'fb.1.1700000000000.42' } });
    await umInstante();
    // Objetos criados dentro do vm têm outro Object.prototype; o JSON iguala.
    const fila = JSON.parse(JSON.stringify((janela.fbq as { queue: unknown[][] }).queue.map((a) => [...a])));
    assert.deepEqual(fila[0].slice(0, 2), ['init', '999']);
    const pv = await beacons[0].corpo;
    assert.deepEqual(fila[1], ['trackSingle', '999', 'PageView', {}, { eventID: pv.id }]);
    assert.equal(pv.fbp, 'fb.1.1700000000000.42');
  });

  test('Lead passa os dados da pessoa ao pixel antes do evento', async () => {
    const { janela, beacons, trk } = rodaScript({ pixel: '999', cookies: { _fbp: 'fb.1.1700000000000.42' } });
    await umInstante();
    trk('lead', { email: ' Ana@Site.com ', telefone: '(11) 98888-7777', nome: 'Ana Maria Souza', cidade: 'São Paulo', estado: 'SP', cep: '01310-100' });
    await umInstante();
    const fila = JSON.parse(JSON.stringify((janela.fbq as { queue: unknown[][] }).queue.map((a) => [...a])));
    const i = fila.findIndex((a: unknown[]) => a[0] === 'init' && (a[2] as Record<string, unknown>).em);
    assert.ok(i > 0);
    const lead = await beacons[1].corpo;
    assert.deepEqual(fila[i], ['init', '999', {
      external_id: lead.vid,
      em: 'ana@site.com',
      ph: '5511988887777',
      fn: 'ana',
      ln: 'maria souza',
      ct: 'sãopaulo',
      st: 'sp',
      zp: '01310100',
      country: 'br',
    }]);
    assert.deepEqual(fila[i + 1], ['trackSingle', '999', 'Lead', {}, { eventID: lead.id }]);
  });

  test('pixel só dispara depois que a coleta responde', async () => {
    const { janela, beacons, respondeColeta } = rodaScript({
      pixel: '999',
      cookies: { _fbp: 'fb.1.1700000000000.42' },
      coleta: 'pendente',
    });
    await umInstante();
    const semTrack = (f: unknown[][]) => f.every((a) => a[0] !== 'trackSingle');
    assert.equal(beacons.length, 1);
    assert.ok(semTrack(filaDoPixel(janela)));
    respondeColeta[0]();
    await umInstante();
    const pv = await beacons[0].corpo;
    const tracks = filaDoPixel(janela).filter((a: unknown[]) => a[0] === 'trackSingle');
    assert.deepEqual(tracks, [['trackSingle', '999', 'PageView', {}, { eventID: pv.id }]]);
  });

  test('coleta com erro não impede o pixel', async () => {
    const { janela } = rodaScript({ pixel: '999', cookies: { _fbp: 'fb.1.1700000000000.42' }, coleta: 'falha' });
    await umInstante();
    const tracks = filaDoPixel(janela).filter((a: unknown[]) => a[0] === 'trackSingle');
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0][2], 'PageView');
  });

  test('ViewContent ao rolar: uma vez por página, só depois do limite', async () => {
    const { janela, documento, beacons, ouvintesJanela } = rodaScript({ rolagem: 50 });
    documento.title = 'Curso de Fisio';
    documento.documentElement.scrollHeight = 4000;
    janela.innerHeight = 800;
    const rola = async (y: number) => {
      janela.pageYOffset = y;
      for (const fn of ouvintesJanela.scroll ?? []) fn({});
      await new Promise((r) => setTimeout(r, 250));
    };

    await rola(1000); // (1000 + 800) / 4000 = 45%
    assert.equal(beacons.length, 1);
    await rola(1300); // 52%
    assert.equal(beacons.length, 2);
    const vc = await beacons[1].corpo;
    assert.equal(vc.ev, 'ViewContent');
    assert.deepEqual(vc.cd, { content_name: 'Curso de Fisio' });
    await rola(3200);
    assert.equal(beacons.length, 2);
  });

  test('ViewContent ao rolar: troca de rota libera de novo; manual substitui', async () => {
    const { janela, documento, beacons, ouvintesJanela, trk } = rodaScript({ rolagem: 25 });
    documento.documentElement.scrollHeight = 2000;
    janela.innerHeight = 500;
    const rola = async (y: number) => {
      janela.pageYOffset = y;
      for (const fn of ouvintesJanela.scroll ?? []) fn({});
      await new Promise((r) => setTimeout(r, 250));
    };

    trk('view_content', { produto: 'Curso' });
    await rola(1500);
    assert.deepEqual((await Promise.all(beacons.map((b) => b.corpo))).map((c) => c.ev), ['PageView', 'ViewContent']);

    (janela.location as { href: string }).href = 'https://www.site.com.br/obrigado';
    trk('pageview');
    await rola(1500);
    assert.deepEqual(
      (await Promise.all(beacons.map((b) => b.corpo))).map((c) => c.ev),
      ['PageView', 'ViewContent', 'PageView', 'ViewContent'],
    );
  });

  test('ViewContent ao rolar: desligado não escuta rolagem', () => {
    const { ouvintesJanela } = rodaScript();
    assert.equal(ouvintesJanela.scroll, undefined);
    assert.ok(montaScript({ endpoint: 'https://x', chave: 'k', pixel: null, rolagem: 500 }).includes('"rolagem":0'));
  });

  test('data-pixel="0" desliga o pixel e mantém o servidor', () => {
    const { janela, beacons } = rodaScript({
      pixel: '999',
      currentScript: { src: 'https://painel.test/t.js?k=x', getAttribute: (n: string) => (n === 'data-pixel' ? '0' : null), hasAttribute: () => false },
    });
    assert.equal(janela.fbq, undefined);
    assert.equal(beacons.length, 1);
  });
});
