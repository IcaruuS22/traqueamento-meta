import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export default async function PaginaRaiz() {
  const sessao = await auth();
  redirect(sessao?.user ? '/app' : '/login');
}
