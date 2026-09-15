'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import {
  acaoExcluirSite,
  acaoSalvarSite,
  acaoSalvarTestEventCode,
  acaoTrocarTokenSite,
} from '@/lib/acoes/paginas';
import type { EstadoFormulario } from '@/lib/auth/actions';
import { Alerta } from '@/components/form';

const ROTULO = 'mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]';

export type SiteEditavel = {
  id: number;
  nome: string;
  dominios: string[];
  ativo: boolean;
};

/**
 * Envio manual em vez de `<form action>`: o React limpa o formulário
 * depois de toda action, e um domínio digitado errado obrigaria a digitar
 * a lista inteira de novo.
 */
function useEnvio(acao: (dados: FormData) => void) {
  return (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  };
}

/** Criação (sem `site`) ou edição de um site rastreado. */
export function FormularioSite({ banco, site }: { banco: string; site?: SiteEditavel }) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(acaoSalvarSite, {});
  const envia = useEnvio(acao);
  const form = useRef<HTMLFormElement>(null);

  // Só a criação limpa ao salvar: na edição os campos já mostram o que foi
  // gravado, e limpar faria parecer que o site perdeu os dados.
  useEffect(() => {
    if (!site && estado.sucesso) form.current?.reset();
  }, [estado, site]);

  return (
    <form ref={form} onSubmit={envia} className="space-y-3">
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

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={site?.ativo ?? true} />
        Ativo
      </label>

      <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={pendente}>
        {pendente ? 'Salvando…' : site ? 'Salvar alterações' : 'Criar site'}
      </button>

      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </form>
  );
}

/** Troca do token do webhook, com confirmação: a URL antiga para na hora. */
export function TrocarToken({ banco, id }: { banco: string; id: number }) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(acaoTrocarTokenSite, {});
  const envia = useEnvio(acao);
  const [aberto, setAberto] = useState(false);

  // Fecha a confirmação quando a troca dá certo; o aviso de sucesso fica
  // visível ao lado do botão.
  const [visto, setVisto] = useState(estado);
  if (estado !== visto) {
    setVisto(estado);
    if (estado.sucesso) setAberto(false);
  }

  if (!aberto) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setAberto(true)} className="btn-ghost px-2 py-1 text-xs">
          Trocar token do webhook
        </button>
        {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
      </div>
    );
  }

  return (
    <form onSubmit={envia} className="space-y-2 rounded-[var(--radius-control)] border border-amber-300 p-3">
      <input type="hidden" name="client_db" value={banco} />
      <input type="hidden" name="id" value={id} />
      <p className="text-xs text-[var(--text-secondary)]">
        As URLs de webhook atuais param de funcionar em até um minuto. Vendas que chegarem pela URL
        antiga depois disso são recusadas até a URL nova ser cadastrada na plataforma de checkout.
        Use quando o token vazou.
      </p>
      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={pendente}>
          {pendente ? 'Trocando…' : 'Trocar agora'}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="btn-ghost px-2 py-1 text-xs">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * Exclusão com confirmação. O aviso de sucesso não mora aqui: a página
 * revalida e o cartão do site some junto com este componente — a ação
 * redireciona com `?excluido=1` e a página mostra o aviso.
 */
export function ExcluirSite({ banco, id, nome }: { banco: string; id: number; nome: string }) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(acaoExcluirSite, {});
  const envia = useEnvio(acao);
  const [aberto, setAberto] = useState(false);

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="btn-ghost px-2 py-1 text-xs text-red-700">
        Excluir site
      </button>
    );
  }

  return (
    <form onSubmit={envia} className="space-y-2 rounded-[var(--radius-control)] border border-red-300 p-3">
      <input type="hidden" name="client_db" value={banco} />
      <input type="hidden" name="id" value={id} />
      <p className="text-xs text-[var(--text-secondary)]">
        Excluir “{nome}” desliga o script e os webhooks deste site na hora. Os eventos já gravados
        continuam no painel. Para só pausar, desmarque “Ativo” em vez de excluir.
      </p>
      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary !bg-red-700 px-3 py-1.5 text-xs" disabled={pendente}>
          {pendente ? 'Excluindo…' : 'Excluir'}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="btn-ghost px-2 py-1 text-xs">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/**
 * Test Event Code da conta.
 *
 * Mesmo campo da tela de WhatsApp (uma coluna só em `ad_accounts`), aqui
 * porque cliente que só tem Página de vendas não enxerga aquela aba.
 * Envio manual pelo mesmo motivo do formulário de site: o React limpa o
 * campo depois da action e o código ficaria fora da vista.
 */
export function TestEventCode({ banco, codigo }: { banco: string; codigo: string | null }) {
  const [estado, acao, pendente] = useActionState<EstadoFormulario, FormData>(
    acaoSalvarTestEventCode,
    {},
  );
  const envia = useEnvio(acao);

  return (
    <form onSubmit={envia} className="space-y-2">
      <input type="hidden" name="client_db" value={banco} />
      <label className="block">
        <span className={ROTULO}>Test Event Code (opcional)</span>
        <input
          name="codigo"
          className="field"
          maxLength={64}
          defaultValue={codigo ?? ''}
          placeholder="ex.: TEST12345"
        />
      </label>
      <p className="text-xs text-[var(--text-tertiary)]">
        Em Gerenciador de Eventos › Testar eventos, a Meta mostra um código. Com ele preenchido, os
        eventos aparecem naquela tela em vez de contar como conversão — e isso vale para TODOS os
        eventos deste cliente, inclusive formulários e WhatsApp. Limpe o campo ao terminar o teste.
      </p>
      <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={pendente}>
        {pendente ? 'Salvando…' : 'Salvar código'}
      </button>
      {estado.erro ? <Alerta tipo="erro">{estado.erro}</Alerta> : null}
      {estado.sucesso ? <Alerta tipo="sucesso">{estado.sucesso}</Alerta> : null}
    </form>
  );
}

/** Bloco de texto com botão de copiar. Segredos começam mascarados. */
export function Copiavel({ rotulo, texto, segredo = false }: { rotulo: string; texto: string; segredo?: boolean }) {
  const [situacao, setSituacao] = useState<'parado' | 'copiado' | 'falhou'>('parado');
  const [visivel, setVisivel] = useState(!segredo);

  async function copia() {
    try {
      await navigator.clipboard.writeText(texto);
      setSituacao('copiado');
    } catch {
      // Sem permissão de área de transferência (http, iframe): mostra o
      // texto para a pessoa copiar na mão.
      setVisivel(true);
      setSituacao('falhou');
    }
    setTimeout(() => setSituacao('parado'), 2500);
  }

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
          <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={copia}>
            {situacao === 'copiado' ? 'Copiado' : situacao === 'falhou' ? 'Copie manualmente' : 'Copiar'}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-field)] p-2 text-xs text-[var(--text-primary)]">
        <code>{visivel ? texto : texto.replace(/token=[a-f0-9]+/, 'token=••••••••')}</code>
      </pre>
    </div>
  );
}
