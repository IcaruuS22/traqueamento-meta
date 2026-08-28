import type { Guia } from './tipos';
import { guiaAppMeta } from './01-app-meta';
import { guiaPixelCapi } from './02-pixel-capi';
import { guiaWebhookLeadgen } from './03-webhook-leadgen';
import { guiaWhatsappCloud } from './04-whatsapp-cloud';

export type { Guia };

/**
 * A sequência importa: os guias 3 e 4 se referem ao app criado no guia 1.
 * A ordem do array é a ordem de execução, e `numero` acompanha.
 */
export const GUIAS: Guia[] = [
  guiaAppMeta,
  guiaPixelCapi,
  guiaWebhookLeadgen,
  guiaWhatsappCloud,
];

export function buscaGuia(id: string): Guia | undefined {
  return GUIAS.find((g) => g.id === id);
}
