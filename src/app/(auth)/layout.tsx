import Link from 'next/link';

export default function LayoutAutenticacao({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-sidebar)] px-4 py-10">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-6 block text-center">
          <span className="text-lg font-semibold tracking-tight">Trakeamento</span>
          <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
            Meta Ads · Kommo · WhatsApp
          </span>
        </Link>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
