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
