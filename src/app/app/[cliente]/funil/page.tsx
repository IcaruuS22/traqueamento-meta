import type { Metadata } from 'next';
import { requireClientAccessPagina } from '@/lib/auth/guard';
import { buscaAnalyticsFunil } from '@/lib/db/funil';
import { primeiroLeadEm } from '@/lib/db/metricas';
import { resolvePeriodo, rotuloPeriodo } from '@/lib/periodo';
import { fmtInt, fmtPct } from '@/lib/format';
import { BarrasHorizontais, Card, Funil, KpiCard, Tabela, Vazio } from '@/components/dados';
import { PageHero } from '@/components/hero';
import { SeletorPeriodo } from '@/components/seletores';
import type { PassoFunil } from '@/lib/funil';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = { title: 'Funil — Trakeamento' };

/**
 * Tela "Funil" — onde o lead para, e por quê.
 *
 * O CRM mostra o quadro, esta tela mostra a conta: quantos ficaram em
 * cada etapa, quanto sobrou de uma para a outra, quais motivos de perda
 * mais aparecem e quais campanhas trazem lead que morre.
 *
 * Os dois funis ficam separados de propósito, pelo mesmo motivo do CRM:
 * são dois cadastros de etapas diferentes, do cliente. O de WhatsApp é do
 * painel e tem `ganho`/`perdido`; o de formulário é espelho do CRM do
 * cliente e quem diz o que é venda lá é o `is_conversion` do cadastro de
 * eventos.
 *
 * Motivo de perda depende da migração `migracao_motivo_perda.sql`. Banco
 * que ainda não rodou continua abrindo a tela inteira — a seção de
 * motivos é que aparece vazia, com o aviso da lacuna em cima.
 */
export default async function PaginaFunil({
  params,
  searchParams,
}: {
  params: Promise<{ cliente: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente } = await params;
  const busca = await searchParams;

  const { db } = await requireClientAccessPagina(decodeURIComponent(cliente));

  const um = (chave: string) => {
    const v = busca[chave];
    return Array.isArray(v) ? v[0] : v;
  };
  const periodo = resolvePeriodo({
    range: um('range'),
    date_from: um('date_from'),
    date_to: um('date_to'),
    channel: 'geral',
  });

  const [dados, minimo] = await Promise.all([
    buscaAnalyticsFunil(db, periodo),
    primeiroLeadEm(db),
  ]);

  const { whatsapp, formulario, motivos, campanhas } = dados;

  return (
    <>
      <PageHero
        titulo="Funil"
        descricao="Onde o contato para em cada funil, por que ele se perde e quais campanhas trazem lead que não fecha."
        acoes={<SeletorPeriodo minimo={minimo} />}
      />

      {dados.lacunas_de_esquema.length ? (
        <p className="mb-4 rounded-[var(--radius-control)] bg-amber-50 px-3 py-2 text-sm text-amber-700">
          O banco deste cliente está atrás do template — falta:{' '}
          <strong>{dados.lacunas_de_esquema.join(', ')}</strong>. As seções que dependem disso
          aparecem vazias; é falta de migração, não falta de dado.
        </p>
      ) : null}

      <p className="mb-4 text-body-small text-tertiary">
        {rotuloPeriodo(periodo)} · contatos contados pela data de entrada
      </p>

      <div className="kpi-grid mb-4">
        <KpiCard rotulo="Contatos de WhatsApp" valor={fmtInt(whatsapp.total)} />
        <KpiCard
          rotulo="Ganhos"
          valor={fmtInt(whatsapp.faixas.ganhos)}
          dica="Conversas no estágio “ganho” do funil de WhatsApp."
        />
        <KpiCard
          rotulo="Perdidos"
          valor={fmtInt(whatsapp.faixas.perdidos)}
          dica="Conversas no estágio “perdido” do funil de WhatsApp."
        />
        <KpiCard
          rotulo="Taxa de ganho"
          valor={`${fmtPct(whatsapp.faixas.taxa_ganho, 1)}`}
          dica="Ganhos sobre o que já foi decidido (ganhos + perdidos). Quem ainda está em aberto não entra na conta."
          destaque
        />
      </div>

      <Card
        titulo="Funil de WhatsApp"
        descricao="Etapas na ordem em que o cliente cadastrou em “Estágios e eventos”. Este é o funil do painel — é ele que muda quando você arrasta um card no CRM."
      >
        {whatsapp.passos.length ? (
          <>
            <Funil
              id="funil-whatsapp"
              itens={whatsapp.passos.map((p) => ({ label: p.rotulo, count: p.total }))}
            />
            <TabelaPassos passos={whatsapp.passos} />
            {whatsapp.fora_do_funil > 0 ? (
              <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                {fmtInt(whatsapp.fora_do_funil)}{' '}
                {whatsapp.fora_do_funil === 1 ? 'contato está' : 'contatos estão'} sem etapa ou em
                etapa que saiu do cadastro — por isso a soma das etapas não fecha com o total.
              </p>
            ) : null}
          </>
        ) : (
          <Vazio>
            Nenhuma etapa ativa em <code>whatsapp_event_map</code>. Cadastre os estágios em
            “Estágios e eventos” para o funil aparecer.
          </Vazio>
        )}
      </Card>

      <Card
        titulo="Motivos de perda"
        descricao="Registrado ao mover o contato para “perdido”, no CRM ou na tela de Conversas."
      >
        {motivos.length ? (
          <BarrasHorizontais
            itens={motivos.map((m) => ({
              rotulo: m.motivo,
              valor: m.total,
              sufixo: ` · ${fmtPct(m.pct, 1)}`,
            }))}
          />
        ) : (
          <Vazio>
            Nenhuma perda registrada no período — ou o motivo ainda não está sendo preenchido.
          </Vazio>
        )}
      </Card>

      <Card
        titulo="Perda por campanha"
        descricao="Ordenado pela taxa de perda, não pelo número absoluto: a campanha maior sempre perde mais em números. Campanha com menos de 5 contatos fica fora — 1 perda em 2 contatos vira 50% e não significa nada."
      >
        {campanhas.length ? (
          <Tabela colunas={['Campanha', 'Contatos', 'Perdidos', 'Taxa de perda']}>
            {campanhas.map((c) => (
              <tr key={c.campanha}>
                <td>{c.campanha}</td>
                <td>{fmtInt(c.total)}</td>
                <td>{fmtInt(c.perdidos)}</td>
                <td>{fmtPct(c.taxa, 1)}</td>
              </tr>
            ))}
          </Tabela>
        ) : (
          <Vazio>Nenhuma campanha com perda registrada no período.</Vazio>
        )}
      </Card>

      <div className="kpi-grid mb-4">
        <KpiCard rotulo="Leads de formulário" valor={fmtInt(formulario.total)} />
        <KpiCard
          rotulo="Conversões"
          valor={fmtInt(formulario.conversoes)}
          dica="Etapas marcadas como conversão em “Configuração de Eventos” — a mesma marcação que alimenta o CAC da aba Campanhas."
        />
        <KpiCard
          rotulo="Taxa de conversão"
          valor={fmtPct(formulario.taxa_conversao, 1)}
          destaque
        />
      </div>

      <Card
        titulo="Funil de formulário"
        descricao="Espelho do CRM do cliente: quem escreve a etapa é a automação. Aqui só se lê."
      >
        {formulario.passos.length ? (
          <>
            <Funil
              id="funil-formulario"
              itens={formulario.passos.map((p) => ({ label: p.rotulo, count: p.total }))}
            />
            <TabelaPassos passos={formulario.passos} />
            {formulario.fora_do_funil > 0 ? (
              <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                {fmtInt(formulario.fora_do_funil)}{' '}
                {formulario.fora_do_funil === 1 ? 'lead está' : 'leads estão'} em etapa que não
                está no cadastro de eventos deste cliente.
              </p>
            ) : null}
          </>
        ) : (
          <Vazio>
            Nenhuma etapa cadastrada em <code>crm_meta_event_map</code>, ou nenhum lead de
            formulário com etapa no período.
          </Vazio>
        )}
      </Card>
    </>
  );
}

/**
 * A tabela é o que o desenho do funil não diz: a coluna "% da anterior" é
 * onde se vê o degrau em que o lead some.
 */
function TabelaPassos({ passos }: { passos: PassoFunil[] }) {
  return (
    <div className="mt-3">
      <Tabela colunas={['Etapa', 'Contatos', '% do total', '% da anterior']}>
        {passos.map((p) => (
          <tr key={p.valor}>
            <td>{p.rotulo}</td>
            <td>{fmtInt(p.total)}</td>
            <td>{fmtPct(p.pct_total, 1)}</td>
            <td>{p.pct_anterior === null ? '—' : fmtPct(p.pct_anterior, 1)}</td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
