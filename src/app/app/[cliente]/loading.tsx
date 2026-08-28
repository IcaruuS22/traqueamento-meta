import { EsqueletoPagina } from '@/components/esqueleto';

// Boundary de carregamento de toda a área do cliente. Todas as telas que
// compartilham este layout (métricas, campanhas, formulários, whatsapp)
// caem aqui quando não têm um loading mais específico — o clique mostra o
// esqueleto na hora, sem esperar a query ao MySQL remoto.
export default function Loading() {
  return <EsqueletoPagina />;
}
