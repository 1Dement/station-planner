'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';

type ManifestItem = {
  id: string;
  pack: string;
  name: string;
  filename: string;
  glb: string;
  category: string;
};

const STORAGE_KEY = 'station-picker-v1';

type State = {
  index: number;
  approved: string[];
  skipped: string[];
};

const empty: State = { index: 0, approved: [], skipped: [] };

export default function PickerPage() {
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [state, setState] = useState<State>(empty);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/models-pack/manifest.json')
      .then(r => r.json())
      .then((data: ManifestItem[]) => {
        setItems(data);
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try { setState(JSON.parse(stored)); } catch {}
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter(i => i.pack === filter);
  }, [items, filter]);

  const current = filtered[state.index];
  const done = state.index >= filtered.length;

  const skip = useCallback(() => {
    if (!current) return;
    setState(s => ({ ...s, index: s.index + 1, skipped: [...s.skipped.filter(id => id !== current.id), current.id], approved: s.approved.filter(id => id !== current.id) }));
  }, [current]);

  const approve = useCallback(() => {
    if (!current) return;
    setState(s => ({ ...s, index: s.index + 1, approved: [...s.approved.filter(id => id !== current.id), current.id], skipped: s.skipped.filter(id => id !== current.id) }));
  }, [current]);

  const back = useCallback(() => {
    setState(s => ({ ...s, index: Math.max(0, s.index - 1) }));
  }, []);

  const reset = () => {
    setState(empty);
    localStorage.removeItem(STORAGE_KEY);
  };

  const restartFiltered = () => {
    setState(s => ({ ...s, index: 0 }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); approve(); }
      else if (e.key === 'ArrowUp' || e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'Escape') { e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip, approve, back]);

  const exportJson = () => {
    const approvedItems = items.filter(i => state.approved.includes(i.id));
    const json = JSON.stringify(approvedItems, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `station-picker-approved-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyApproved = async () => {
    const approvedItems = items.filter(i => state.approved.includes(i.id));
    const lines = approvedItems.map(i => `- ${i.name} (${i.pack}/${i.filename}) [${i.category}]`).join('\n');
    await navigator.clipboard.writeText(lines);
    alert(`Copiat ${approvedItems.length} items in clipboard. Spune Claude "integreaza picks".`);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading manifest...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e8e8e8', fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid #1f1f2a', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Link href="/library" style={{ color: '#c9a227', textDecoration: 'none', fontWeight: 600 }}>← Catalog</Link>
        <h1 style={{ margin: 0, fontSize: 18, color: '#c9a227', fontFamily: 'Space Grotesk, Inter, sans-serif' }}>🎯 3D Picker — Skip / Approve</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 13, alignItems: 'center' }}>
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); setState(s => ({ ...s, index: 0 })); }}
            style={{ background: '#1a1a24', color: '#e8e8e8', border: '1px solid #2a2a36', borderRadius: 4, padding: '6px 10px' }}
          >
            <option value="all">Toate ({items.length})</option>
            <option value="mini-market">Mini Market ({items.filter(i => i.pack === 'mini-market').length})</option>
            <option value="food-kit">Food Kit ({items.filter(i => i.pack === 'food-kit').length})</option>
          </select>
          <button onClick={reset} style={{ background: 'transparent', border: '1px solid #2a2a36', color: '#888', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>↺ Reset tot</button>
          <button onClick={restartFiltered} style={{ background: 'transparent', border: '1px solid #2a2a36', color: '#888', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>↻ Restart filtru</button>
        </div>
      </header>

      <div style={{ padding: '8px 24px', background: '#0f0f17', borderBottom: '1px solid #1f1f2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
        <div>
          Progress: <strong style={{ color: '#c9a227' }}>{state.index}</strong> / {filtered.length}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span>✅ Approved: <strong style={{ color: '#30d158' }}>{state.approved.length}</strong></span>
          <span>❌ Skipped: <strong style={{ color: '#ff453a' }}>{state.skipped.length}</strong></span>
        </div>
      </div>

      {!done && current && (
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 }}>
          <div style={{ fontSize: 22, color: '#c9a227', fontWeight: 600, textAlign: 'center', fontFamily: 'Space Grotesk, Inter, sans-serif' }}>
            {current.name}
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>
            {current.pack} · {current.category} · {current.filename}
          </div>

          <div style={{ width: '100%', maxWidth: 700, height: 'min(520px, 60vh)', background: '#11111a', border: '1px solid #1f1f2a', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
            <model-viewer
              key={current.id}
              src={current.glb}
              alt={current.name}
              camera-controls
              auto-rotate
              auto-rotate-delay="0"
              rotation-per-second="20deg"
              shadow-intensity="0.8"
              tone-mapping="commerce"
              exposure="1.1"
              style={{ width: '100%', height: '100%', background: 'transparent' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button
              onClick={skip}
              style={{
                background: '#ff453a', color: '#0a0a0f', border: 0, padding: '16px 36px',
                borderRadius: 12, fontWeight: 800, fontSize: 18, cursor: 'pointer',
                letterSpacing: 0.5, minWidth: 180,
              }}
              title="←"
            >
              ❌ SKIP
            </button>
            <button
              onClick={back}
              style={{
                background: 'transparent', color: '#888', border: '1px solid #2a2a36',
                padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
              }}
              title="↑ sau Backspace"
            >
              ↩ Înapoi
            </button>
            <button
              onClick={approve}
              style={{
                background: '#30d158', color: '#0a0a0f', border: 0, padding: '16px 36px',
                borderRadius: 12, fontWeight: 800, fontSize: 18, cursor: 'pointer',
                letterSpacing: 0.5, minWidth: 180,
              }}
              title="→"
            >
              ✅ APPROVE
            </button>
          </div>

          <div style={{ fontSize: 11, color: '#555', textAlign: 'center' }}>
            Hotkeys: <kbd style={{ background: '#1a1a24', padding: '2px 6px', borderRadius: 3, border: '1px solid #2a2a36' }}>←</kbd> skip · <kbd style={{ background: '#1a1a24', padding: '2px 6px', borderRadius: 3, border: '1px solid #2a2a36' }}>→</kbd> approve · <kbd style={{ background: '#1a1a24', padding: '2px 6px', borderRadius: 3, border: '1px solid #2a2a36' }}>↑</kbd> back
          </div>
        </main>
      )}

      {done && (
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <h2 style={{ color: '#c9a227', fontSize: 28, fontFamily: 'Space Grotesk, Inter, sans-serif', margin: 0 }}>Gata!</h2>
          <div style={{ fontSize: 16, color: '#bbb' }}>
            ✅ <strong style={{ color: '#30d158' }}>{state.approved.length}</strong> approved · ❌ <strong style={{ color: '#ff453a' }}>{state.skipped.length}</strong> skipped
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={copyApproved} style={{ background: '#c9a227', color: '#0a0a0f', border: 0, padding: '12px 24px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
              📋 Copy list approved (text)
            </button>
            <button onClick={exportJson} style={{ background: '#1a1a24', color: '#e8e8e8', border: '1px solid #2a2a36', padding: '12px 24px', borderRadius: 8, cursor: 'pointer' }}>
              💾 Export JSON
            </button>
            <button onClick={restartFiltered} style={{ background: 'transparent', color: '#888', border: '1px solid #2a2a36', padding: '12px 24px', borderRadius: 8, cursor: 'pointer' }}>
              ↻ Restart picker
            </button>
          </div>

          {state.approved.length > 0 && (
            <div style={{ marginTop: 24, width: '100%', maxWidth: 1100 }}>
              <h3 style={{ color: '#c9a227', fontSize: 16, marginBottom: 12 }}>Aprobate ({state.approved.length})</h3>
              <div style={{
                display: 'grid', gap: 12,
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              }}>
                {items.filter(i => state.approved.includes(i.id)).map(i => (
                  <div key={i.id} style={{ background: '#11111a', border: '1px solid #2a2a36', borderRadius: 8, padding: 8 }}>
                    <model-viewer
                      src={i.glb}
                      alt={i.name}
                      camera-controls
                      auto-rotate
                      style={{ width: '100%', height: 120, background: '#0a0a0f' }}
                    />
                    <div style={{ fontSize: 11, color: '#e8e8e8', marginTop: 6, fontWeight: 600 }}>{i.name}</div>
                    <div style={{ fontSize: 9, color: '#666' }}>{i.category}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, fontSize: 12, color: '#666', textAlign: 'center', maxWidth: 600, lineHeight: 1.5 }}>
            Spune Claude <strong style={{ color: '#c9a227' }}>"integreaza picks"</strong> → Claude citeste lista aprobata si adauga items in catalog cu nume traduse RO + dimensiuni standard + GLB linkate. Commit + push → live in ~45s.
          </div>
        </main>
      )}
    </div>
  );
}
