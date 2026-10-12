import ClientPage from '@/components/ClientPage';
import { Suspense } from 'react';

export default function Home() {
  return (
    <Suspense fallback={<div className="p-4 bg-slate-950 text-slate-400">Loading...</div>}>
      <ClientPage />
    </Suspense>
  );
}
