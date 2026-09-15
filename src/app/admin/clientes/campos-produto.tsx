'use client';

import { useState } from 'react';
import { Campo } from '@/components/form';
import { ROTULO_PRODUTO, type Produto } from '@/lib/produtos';

/**
 * Dados iniciais de cada produto, usados no cadastro de cliente novo e no
 * "Adicionar produto" da lista de clientes. Os nomes dos campos são os
 * que `leDadosDosProdutos` lê no servidor.
 *
 * Tokens em `type="password"` e `autoComplete="off"`: o cadastro costuma
 * ser feito com a tela compartilhada, e o navegador não deve guardá-los.
 */

const CAIXA = 'space-y-4 rounded-[var(--radius-control)] border border-[var(--border-default)] p-4';
const LEGENDA = 'px-1 text-sm font-medium text-[var(--text-secondary)]';
const NOTA = 'text-xs text-[var(--text-tertiary)]';

export function CamposDoProduto({ produto }: { produto: Produto }) {
  switch (produto) {
    case 'formularios':
      return <CamposFormularios />;
    case 'landing_page':
      return <CamposLandingPage />;
    case 'whatsapp':
      return <CamposWhatsapp />;
  }
}

function CamposFormularios() {
  return (
    <fieldset className={CAIXA}>
      <legend className={LEGENDA}>{ROTULO_PRODUTO.formularios}</legend>
      <p className={NOTA}>
        Os leads dos formulários entram no Kommo, e é o funil do Kommo que devolve as conversões
        para a Meta.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="ID da conta no Kommo" name="crm_account_id" required maxLength={255} />
        <Campo
          label="Token de acesso do Kommo"
          name="kommo_access_token"
          type="password"
          required
          autoComplete="off"
        />
        <Campo
          label="Subdomínio do Kommo"
          name="kommo_subdomain"
          maxLength={120}
          placeholder="minhaempresa"
          dica="Só o nome da conta, sem https e sem .kommo.com. Usado pela automação de negócios perdidos."
        />
      </div>
    </fieldset>
  );
}

function CamposLandingPage() {
  return (
    <fieldset className={CAIXA}>
      <legend className={LEGENDA}>{ROTULO_PRODUTO.landing_page}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Nome do site" name="site_nome" required maxLength={120} placeholder="Página do curso" />
        <Campo
          label="Domínios (separados por vírgula)"
          name="site_dominios"
          required
          maxLength={2000}
          placeholder="meusite.com.br, lp.meusite.com.br"
          dica="O domínio libera os subdomínios. Para testar numa prévia (Lovable, Vercel), inclua o domínio da prévia."
        />
      </div>
      <p className={NOTA}>
        A tag do site e as URLs de webhook de compra aparecem em Página de vendas › Configuração,
        no painel do cliente, depois de salvar.
      </p>
    </fieldset>
  );
}

function CamposWhatsapp() {
  const [via, setVia] = useState<'cloud' | 'evolution'>('cloud');

  return (
    <fieldset className={CAIXA}>
      <legend className={LEGENDA}>{ROTULO_PRODUTO.whatsapp}</legend>
      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Integração do WhatsApp">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="whatsapp_via"
            value="cloud"
            checked={via === 'cloud'}
            onChange={() => setVia('cloud')}
          />
          Cloud API (Meta)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="whatsapp_via"
            value="evolution"
            checked={via === 'evolution'}
            onChange={() => setVia('evolution')}
          />
          Evolution API (QR Code)
        </label>
      </div>

      {via === 'cloud' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            label="ID do número de telefone"
            name="cloud_phone_number_id"
            required
            inputMode="numeric"
            maxLength={64}
            dica="Phone Number ID, no WhatsApp Manager da Meta."
          />
          <Campo label="ID da conta do WhatsApp Business (opcional)" name="cloud_waba_id" maxLength={64} />
          <Campo
            label="Token de acesso da Cloud API"
            name="cloud_access_token"
            type="password"
            required
            autoComplete="off"
            dica="Token permanente do System User."
          />
        </div>
      ) : (
        <p className={NOTA}>
          A Evolution conecta lendo o QR Code com o celular do cliente, então não há dado para
          preencher agora. Depois de salvar, abra a tela Conexão do WhatsApp do cliente para informar
          o servidor e ler o QR Code.
        </p>
      )}
    </fieldset>
  );
}
