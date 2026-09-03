import 'server-only';
import { env } from '@/lib/env';

/**
 * Envio de e-mail transacional (convite e redefinição de senha).
 *
 * Quando SMTP não está configurado, nada é enviado e o link é impresso no
 * log do servidor. Isso é proposital: em desenvolvimento — e no primeiro
 * deploy, antes de haver um remetente — o fluxo de convite precisa
 * funcionar mesmo assim. O administrador copia o link do log e entrega
 * pelo canal que preferir.
 *
 * O `nodemailer` é importado dinamicamente para não entrar no bundle de
 * quem apenas importa este módulo sem enviar nada.
 */

type Mensagem = {
  para: string;
  assunto: string;
  texto: string;
  html: string;
};

async function envia({ para, assunto, texto, html }: Mensagem): Promise<boolean> {
  if (!env.smtp.configurado) {
    console.warn(
      `[email] SMTP não configurado: mensagem NÃO enviada para ${para}.\n` +
        `        Assunto: ${assunto}\n` +
        `        Conteúdo:\n${texto}`,
    );
    return false;
  }

  try {
    const nodemailer = (await import('nodemailer')).default;
    const transporte = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.password },
    });

    await transporte.sendMail({
      from: env.smtp.from,
      to: para,
      subject: assunto,
      text: texto,
      html,
    });
    return true;
  } catch (erro) {
    // Falha de envio não pode derrubar a ação que gerou o e-mail: o
    // convite já foi criado no banco e continua válido; o link está no log.
    console.error(`[email] falha ao enviar para ${para}:`, erro);
    return false;
  }
}

/** Moldura HTML mínima, sem imagens externas nem CSS remoto. */
function moldura(titulo: string, corpo: string, botao: { texto: string; url: string }): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#262a32;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:20px;">${escapaHtml(titulo)}</h1>
        <div style="font-size:15px;line-height:1.6;">${corpo}</div>
        <p style="margin:28px 0;">
          <a href="${escapaHtml(botao.url)}"
             style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">
            ${escapaHtml(botao.texto)}
          </a>
        </p>
        <p style="font-size:13px;color:#6b7280;line-height:1.5;margin:0;">
          Se o botão não funcionar, copie e cole este endereço no navegador:<br>
          <span style="word-break:break-all;">${escapaHtml(botao.url)}</span>
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapaHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function enviaEmailConvite(email: string, token: string): Promise<boolean> {
  const url = `${env.appUrl}/signup?convite=${encodeURIComponent(token)}`;
  return envia({
    para: email,
    assunto: 'Seu acesso ao painel de trakeamento',
    texto:
      `Você foi convidado para o painel de trakeamento.\n\n` +
      `Crie sua senha em: ${url}\n\n` +
      `O convite vale por 7 dias.`,
    html: moldura(
      'Você foi convidado para o painel',
      '<p style="margin:0;">Use o botão abaixo para criar sua senha e acessar o painel. O convite vale por <strong>7 dias</strong>.</p>',
      { texto: 'Criar minha senha', url },
    ),
  });
}

export async function enviaEmailRedefinicao(email: string, token: string): Promise<boolean> {
  const url = `${env.appUrl}/redefinir-senha?token=${encodeURIComponent(token)}`;
  return envia({
    para: email,
    assunto: 'Redefinição de senha no painel de trakeamento',
    texto:
      `Recebemos um pedido para redefinir a senha desta conta.\n\n` +
      `Defina uma nova senha em: ${url}\n\n` +
      `O link vale por 1 hora. Se você não pediu isso, ignore este e-mail.`,
    html: moldura(
      'Redefinir sua senha',
      '<p style="margin:0;">Recebemos um pedido para redefinir a senha desta conta. O link vale por <strong>1 hora</strong>.</p>' +
        '<p style="margin:12px 0 0;">Se você não pediu isso, ignore este e-mail: sua senha atual continua valendo.</p>',
      { texto: 'Definir nova senha', url },
    ),
  });
}

export async function enviaEmailContaAprovada(email: string): Promise<boolean> {
  const url = `${env.appUrl}/login`;
  return envia({
    para: email,
    assunto: 'Seu acesso foi liberado',
    texto: `Sua conta foi liberada por um administrador. Acesse em: ${url}`,
    html: moldura(
      'Seu acesso foi liberado',
      '<p style="margin:0;">Um administrador liberou sua conta. Você já pode entrar com o e-mail e a senha que cadastrou.</p>',
      { texto: 'Acessar o painel', url },
    ),
  });
}
