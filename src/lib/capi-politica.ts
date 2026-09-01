/**
 * Quando o evento de etapa exige que o lead tenha vindo de anúncio.
 *
 * Módulo próprio, sem `server-only`, porque `env.ts` não pode ser
 * importado pelos testes — é a regra que se quer garantir, e ela não
 * depende de nada do servidor. `env.meta.exigeAnuncioWhatsapp` é só o
 * leitor de `process.env` em cima desta função.
 *
 * O padrão é por ambiente: ligada em produção, onde um evento que a Meta
 * não consegue atribuir a anúncio nenhum infla a contagem do Gerenciador
 * sem representar resultado de campanha; desligada em desenvolvimento,
 * onde quem testa o funil manda mensagem do próprio celular, sem passar
 * por anúncio, e a trava faria o teste nunca disparar nada.
 *
 * A variável vence os dois lados, e só 'true' liga: um valor escrito
 * errado deixa a trava desligada em vez de ligá-la por engano — o
 * inverso mataria eventos legítimos sem ninguém entender por quê.
 */
export function exigeAnuncioWhatsapp(nodeEnv: string | undefined, variavel: string | undefined) {
  if (variavel === undefined || variavel === '') return nodeEnv === 'production';
  return variavel === 'true';
}

/**
 * Modo de envio dos eventos de WhatsApp.
 *
 * `teste` é o padrão em toda parte — coluna, formulário e leitura de
 * banco sem a migração. Um valor desconhecido também cai em `teste`, e
 * não em `producao`: modo escrito errado que vira conversão real é o
 * erro caro; modo escrito errado que vira evento de teste é o barato.
 */
export type ModoCapiWhatsapp = 'desligado' | 'teste' | 'producao';

export function normalizaModoCapi(valor: string | null | undefined): ModoCapiWhatsapp {
  return valor === 'desligado' || valor === 'producao' ? valor : 'teste';
}

export type CredenciaisCapiWhatsapp = {
  modo: ModoCapiWhatsapp;
  /** Dataset de mensagens. Nunca o dos formulários. */
  dataset_id: string | null;
  test_event_code: string | null;
};

export type DecisaoCapi =
  | { envia: true; test_event_code: string | null }
  | { envia: false; motivo: string };

/**
 * Decide se o evento de WhatsApp sai, e como.
 *
 * A regra que esta função existe para garantir é uma só: evento de
 * WhatsApp só sai pelo dataset de mensagens. Antes ele caía no dataset
 * dos formulários por não haver outro, e conversa virava conversão no
 * pixel do site. Por isso não há queda para o dataset do cliente aqui —
 * sem `dataset_id` o evento não sai, e o motivo diz o que falta.
 *
 * Em `teste` o código é obrigatório: sem `test_event_code` a Meta trata
 * o evento como real, ou seja, "teste sem código" entregaria exatamente
 * o que o modo promete evitar. Melhor não enviar e dizer o porquê.
 *
 * Função pura e sem `server-only` para poder ser testada sem banco; a
 * leitura das colunas está em `lib/db/whatsapp.ts`.
 */
export function decideEnvioCapiWhatsapp(c: CredenciaisCapiWhatsapp): DecisaoCapi {
  if (c.modo === 'desligado') {
    return { envia: false, motivo: 'envio de eventos de WhatsApp desligado na conexão' };
  }
  if (!c.dataset_id) {
    return {
      envia: false,
      motivo: 'sem dataset de mensagens cadastrado na conexão do WhatsApp',
    };
  }
  if (c.modo === 'teste' && !c.test_event_code) {
    return {
      envia: false,
      motivo: 'modo teste sem Test Event Code: o evento sairia valendo como conversão real',
    };
  }
  return { envia: true, test_event_code: c.modo === 'teste' ? c.test_event_code : null };
}
