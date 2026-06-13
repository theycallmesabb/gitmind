'use client';

import React, { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function AuthCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      localStorage.setItem('gitmind', token);
      router.replace('/');
    } else {
      router.replace('/');
    }
  }, [searchParams, router]);

  return (
    <div className="flex-1 flex flex-col justify-center items-center gap-4 bg-[#030303] text-white">
      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      <p className="text-sm text-zinc-400 animate-pulse">Syncing authentication details...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex flex-col justify-center items-center bg-[#030303] text-white">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    }>
      <AuthCallbackHandler />
    </Suspense>
  );
}
