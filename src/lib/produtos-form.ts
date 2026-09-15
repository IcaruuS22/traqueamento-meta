import { z } from 'zod';
import { normalizaDominios } from '@/lib/paginas-web';
import type { Produto } from '@/lib/produtos';

/**
 * Validação dos dados iniciais de cada produto.
 *
 * Fica fora das Server Actions porque dois lugares pedem os mesmos
 * campos: o cadastro de cliente novo e o "Adicionar produto" da lista de
 * clientes. Com uma regra só, um produto adicionado depois nasce igual a
 * um escolhido no cadastro.
 *
 * Só valida. Nada aqui grava no banco, e os tokens voltam para quem
 * chamou sem passar por log nenhum.
 */

export type DadosFormularios = {
  crm_account_id: string;
  kommo_access_token: string;
  kommo_subdomain: string | null;
};

export type DadosLandingPage = {
  nome: string;
  dominios: string[];
  kommo_pipeline_id: string | null;
  kommo_status_id: string | null;
  envia_kommo: boolean;
};

export type DadosWhatsapp =
  | {
      via: 'cloud';
      cloud_phone_number_id: string;
      cloud_waba_id: string | null;
      cloud_access_token: string;
    }
  | { via: 'evolution' };

export type DadosDosProdutos = {
  formularios?: DadosFormularios;
  landing_page?: DadosLandingPage;
  whatsapp?: DadosWhatsapp;
};

/** O que `FormData` oferece e o teste consegue imitar. */
type Campos = { get(nome: string): unknown };

/** Aceita a URL inteira colada e guarda só o subdomínio. */
export function soOSubdominio(valor: string): string {
  return valor
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.kommo\.com$/i, '')
    .trim()
    .toLowerCase();
}

export function subdominioKommoValido(subdominio: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(subdominio);
}

const texto = (campos: Campos, nome: string) => String(campos.get(nome) ?? '').trim();

const idKommo = z
  .string()
  .max(20)
  .refine((v) => v === '' || /^\d+$/.test(v), 'Use só o número do ID do Kommo.')
  .transform((v) => (v === '' ? null : v));

const schemaFormularios = z.object({
  crm_account_id: z
    .string()
    .min(1, 'Formulários Instantâneos: informe o ID da conta no Kommo.')
    .max(255),
  kommo_access_token: z
    .string()
    .min(20, 'Formulários Instantâneos: o token do Kommo parece curto demais.')
    .max(4000),
  kommo_subdomain: z.string().max(120),
});

const schemaLanding = z.object({
  nome: z.string().min(2, 'Landing page: dê um nome ao site.').max(120),
  dominios: z.string().max(2000),
  kommo_pipeline_id: idKommo,
  kommo_status_id: idKommo,
});

const schemaCloud = z.object({
  cloud_phone_number_id: z
    .string()
    .min(1, 'WhatsApp: informe o ID do número de telefone (phone_number_id).')
    .max(64)
    .refine((v) => /^\d+$/.test(v), 'WhatsApp: o phone_number_id tem só números.'),
  cloud_waba_id: z.string().max(64),
  cloud_access_token: z
    .string()
    .min(20, 'WhatsApp: o token da Cloud API parece curto demais.')
    .max(512),
});

function primeiroErro(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? 'Dados inválidos';
}

/**
 * Lê do formulário os campos dos produtos pedidos. Campos de produto não
 * escolhido são ignorados, mesmo que tenham chegado preenchidos.
 */
export function leDadosDosProdutos(
  campos: Campos,
  produtos: readonly Produto[],
): { dados: DadosDosProdutos } | { erro: string } {
  const dados: DadosDosProdutos = {};

  if (produtos.includes('formularios')) {
    const p = schemaFormularios.safeParse({
      crm_account_id: texto(campos, 'crm_account_id'),
      kommo_access_token: texto(campos, 'kommo_access_token'),
      kommo_subdomain: texto(campos, 'kommo_subdomain'),
    });
    if (!p.success) return { erro: primeiroErro(p.error) };

    const sub = soOSubdominio(p.data.kommo_subdomain);
    if (sub !== '' && !subdominioKommoValido(sub)) {
      return { erro: 'Subdomínio do Kommo inválido. Use só o nome da conta, como "minhaempresa".' };
    }
    dados.formularios = {
      crm_account_id: p.data.crm_account_id,
      kommo_access_token: p.data.kommo_access_token,
      kommo_subdomain: sub === '' ? null : sub,
    };
  }

  if (produtos.includes('landing_page')) {
    const p = schemaLanding.safeParse({
      nome: texto(campos, 'site_nome'),
      dominios: texto(campos, 'site_dominios'),
      kommo_pipeline_id: texto(campos, 'site_kommo_pipeline_id'),
      kommo_status_id: texto(campos, 'site_kommo_status_id'),
    });
    if (!p.success) return { erro: primeiroErro(p.error) };

    const { dominios, invalidos } = normalizaDominios(p.data.dominios);
    if (invalidos.length) {
      return { erro: `Landing page: domínio inválido: ${invalidos.slice(0, 3).join(', ')}` };
    }
    if (!dominios.length) {
      return {
        erro: 'Landing page: cadastre ao menos um domínio. Sem domínio, o site não aceita evento nenhum.',
      };
    }
    if (p.data.kommo_status_id && !p.data.kommo_pipeline_id) {
      return { erro: 'Landing page: a etapa do Kommo só vale junto com o funil.' };
    }
    dados.landing_page = {
      nome: p.data.nome,
      dominios,
      kommo_pipeline_id: p.data.kommo_pipeline_id,
      kommo_status_id: p.data.kommo_status_id,
      envia_kommo: campos.get('site_envia_kommo') === 'on',
    };
  }

  if (produtos.includes('whatsapp')) {
    if (texto(campos, 'whatsapp_via') === 'evolution') {
      dados.whatsapp = { via: 'evolution' };
    } else {
      const p = schemaCloud.safeParse({
        cloud_phone_number_id: texto(campos, 'cloud_phone_number_id'),
        cloud_waba_id: texto(campos, 'cloud_waba_id'),
        cloud_access_token: texto(campos, 'cloud_access_token'),
      });
      if (!p.success) return { erro: primeiroErro(p.error) };
      dados.whatsapp = {
        via: 'cloud',
        cloud_phone_number_id: p.data.cloud_phone_number_id,
        cloud_waba_id: p.data.cloud_waba_id || null,
        cloud_access_token: p.data.cloud_access_token,
      };
    }
  }

  return { dados };
}
