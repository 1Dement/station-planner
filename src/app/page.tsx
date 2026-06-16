'use client';

import dynamic from 'next/dynamic';

const SceneEditor = dynamic(() => import('@/components/SceneEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center" style={{ background: '#eaecf0' }}>
      <div className="text-center">
        <div className="text-4xl mb-4" style={{ color: '#2a4a6a' }}>Station Planner 3D</div>
        <div className="text-sm" style={{ color: '#666', opacity: 0.8 }}>Se incarca editorul 3D...</div>
      </div>
    </div>
  ),
});

export default function Home() {
  return <SceneEditor />;
}
