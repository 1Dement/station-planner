'use client';

import dynamic from 'next/dynamic';

const SceneEditor = dynamic(() => import('@/components/SceneEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#1a1a2e' }}>
      <div className="text-center">
        <div className="text-4xl mb-4" style={{ color: '#e94560' }}>Station Planner 3D</div>
        <div className="text-sm" style={{ color: '#e0e0e0', opacity: 0.6 }}>Se incarca editorul 3D...</div>
      </div>
    </div>
  ),
});

export default function Home() {
  return <SceneEditor />;
}
