'use client';

import { useActionState, useState } from 'react';
import { acaoExcluirSite, acaoSalvarSite, acaoTrocarTokenSite } from '@/lib/acoes/paginas';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta, BotaoEnviar } from '@/components/form';

const ROTULO = 'mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]';

export type SiteEditavel = {
  id: number;
  nome: string;
  dominios: string[];
  kommo_pipeline_id: string | null;
  kommo_status_id: string | null;
  envia_kommo: boolean;
  ativo: boolean;
};

/** Criação (sem `site`) ou edição de um site rastreado. */
export function FormularioSite({ banco, site }: { banco: string; site?: SiteEditavel }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoSalvarSite, {});

  return (
    <form action={acao} className="space-y-3">
      <input type="hidden" name="client_db" value={banco} />
      {site ? <input type="hidden" name="id" value={site.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={ROTULO}>Nome do site</span>
          <input
            name="nome"
            className="field"
            required
            maxLength={120}
            defaultValue={site?.nome ?? ''}
            placeholder="ex.: Página do curso"
          />
        </label>
        <label className="block">
          <span className={ROTULO}>Domínios (separados por vírgula)</span>
          <input
            name="dominios"
            className="field"
            required
            maxLength={2000}
            defaultValue={site?.dominios.join(', ') ?? ''}
            placeholder="ex.: meusite.com.br, lp.meusite.com.br"
          />
        </label>
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">
        O domínio libera ele mesmo e os subdomínios: <code>meusite.com.br</code> vale para{' '}
        <code>www.meusite.com.br</code>. Evento de página fora da lista é recusado. Para testar
        numa prévia (Lovable, Vercel), inclua o domínio da prévia também.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={ROTULO}>ID do funil no Kommo (opcional)</span>
          <input
            name="kommo_pipeline_id"
            className="field"
            inputMode="numeric"
            maxLength={20}
            defaultValue={site?.kommo_pipeline_id ?? ''}
            placeholder="em branco: funil principal"
          />
        </label>
        <label className="block">
          <span className={ROTULO}>ID da etapa de entrada (opcional)</span>
          <input
            name="kommo_status_id"
            className="field"
            inputMode="numeric"
            maxLength={20}
            defaultValue={site?.kommo_status_id ?? ''}
            placeholder="em branco: primeira etapa"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="envia_kommo" defaultChecked={site?.envia_kommo ?? true} />
          Criar lead no Kommo quando um formulário da página for enviado
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="ativo" defaultChecked={site?.ativo ?? true} />
          Ativo
        </label>
      </div>

      <BotaoEnviar carregando="Salvando…" className="!w-auto px-3 py-1.5 text-xs">
        {site ? 'Salvar alterações' : 'Criar site'}
      </BotaoEnviar>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </form>
  );
}

/** Troca do token do webhook, com confirmação: a URL antiga para na hora. */
export function TrocarToken({ banco, id }: { banco: string; id: number }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoTrocarTokenSite, {});
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setAberto(true)} className="btn-ghost px-2 py-1 text-xs">
          Trocar token do webhook
        </button>
        {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
        {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
      </div>
    );
  }

  return (
    <form action={acao} className="space-y-2 rounded-[var(--radius-control)] bg-amber-50 p-3">
      <input type="hidden" name="client_db" value={banco} />
      <input type="hidden" name="id" value={id} />
      <p className="text-xs text-amber-800">
        As URLs de webhook atuais param de funcionar em até um minuto. Vendas que chegarem pela URL
        antiga depois disso são recusadas até a URL nova ser cadastrada na plataforma de checkout.
        Use quando o token vazou.
      </p>
      <div className="flex items-center gap-2">
        <BotaoEnviar carregando="Trocando…" className="!w-auto px-3 py-1.5 text-xs">
          Trocar agora
        </BotaoEnviar>
        <button type="button" onClick={() => setAberto(false)} className="btn-ghost px-2 py-1 text-xs">
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function ExcluirSite({ banco, id, nome }: { banco: string; id: number; nome: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(acaoExcluirSite, {});
  const [aberto, setAberto] = useState(false);

  if (estado.sucesso) return <Alerta tipo="sucesso">{estado.sucesso}</Alerta>;

  if (!aberto) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setAberto(true)} className="btn-ghost px-2 py-1 text-xs text-red-700">
          Excluir site
        </button>
        {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      </div>
    );
  }

  return (
    <form action={acao} className="space-y-2 rounded-[var(--radius-control)] bg-red-50 p-3">
      <input type="hidden" name="client_db" value={banco} />
      <input type="hidden" name="id" value={id} />
      <p className="text-xs text-red-700">
        Excluir “{nome}” desliga o script e os webhooks deste site na hora. Os eventos já gravados
        continuam no painel. Para só pausar, desmarque “Ativo” em vez de excluir.
      </p>
      <div className="flex items-center gap-2">
        <BotaoEnviar carregando="Excluindo…" className="!w-auto !bg-red-700 px-3 py-1.5 text-xs">
          Excluir
        </BotaoEnviar>
        <button type="button" onClick={() => setAberto(false)} className="btn-ghost px-2 py-1 text-xs">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Bloco de texto com botão de copiar. */
export function Copiavel({ rotulo, texto, segredo = false }: { rotulo: string; texto: string; segredo?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const [visivel, setVisivel] = useState(!segredo);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={ROTULO + ' !mb-0'}>{rotulo}</span>
        <div className="flex gap-1">
          {segredo ? (
            <button type="button" onClick={() => setVisivel((v) => !v)} className="btn-ghost px-2 py-0.5 text-xs">
              {visivel ? 'Ocultar' : 'Mostrar'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost px-2 py-0.5 text-xs"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(texto);
                setCopiado(true);
                setTimeout(() => setCopiado(false), 1500);
              } catch {
                setCopiado(false);
              }
            }}
          >
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-[var(--surface-muted,#f4f4f5)] p-2 text-xs">
        <code>{visivel ? texto : texto.replace(/token=[a-f0-9]+/, 'token=••••••••')}</code>
      </pre>
    </div>
  );
}
