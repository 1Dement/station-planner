'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { CATALOG, CATEGORIES, type CatalogItem } from '@/lib/catalog';

export default function LibraryPage() {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [onlyWith3D, setOnlyWith3D] = useState(false);

  const filtered = useMemo(() => {
    return CATALOG.filter((it) => {
      if (activeCategory !== 'all' && it.category !== activeCategory) return false;
      if (onlyWith3D && !it.glb) return false;
      if (search && !it.name.toLowerCase().includes(search.toLowerCase()) &&
          !it.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [activeCategory, search, onlyWith3D]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    map.set('all', CATALOG.length);
    for (const c of CATEGORIES) map.set(c.id, 0);
    for (const it of CATALOG) map.set(it.category, (map.get(it.category) || 0) + 1);
    return map;
  }, []);

  const with3DCount = CATALOG.filter(it => it.glb).length;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e8e8e8', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #1f1f2a', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/" style={{ color: '#c9a227', textDecoration: 'none', fontWeight: 600 }}>← Editor</Link>
        <h1 style={{ margin: 0, fontSize: 20, color: '#c9a227', fontFamily: 'Space Grotesk, Inter, sans-serif' }}>Catalog Mobilier &amp; Echipamente Stație</h1>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#888' }}>
          {filtered.length} / {CATALOG.length} items · {with3DCount} cu model 3D real
        </span>
      </header>

      <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 65px)' }}>
        <aside style={{ width: 240, background: '#0f0f17', borderRight: '1px solid #1f1f2a', padding: 16, overflowY: 'auto' }}>
          <input
            type="text"
            placeholder="Caută..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px', marginBottom: 12,
              background: '#1a1a24', border: '1px solid #2a2a36', borderRadius: 4,
              color: '#e8e8e8', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={onlyWith3D}
              onChange={(e) => setOnlyWith3D(e.target.checked)}
              style={{ accentColor: '#c9a227' }}
            />
            Doar items cu 3D real
          </label>

          <div style={{ marginTop: 12 }}>
            <CategoryButton
              icon="📚" name="Toate" id="all"
              count={counts.get('all') || 0}
              active={activeCategory === 'all'}
              onClick={() => setActiveCategory('all')}
            />
            {CATEGORIES.map((cat) => (
              <CategoryButton
                key={cat.id}
                icon={cat.icon}
                name={cat.name}
                id={cat.id}
                count={counts.get(cat.id) || 0}
                active={activeCategory === cat.id}
                onClick={() => setActiveCategory(cat.id)}
              />
            ))}
          </div>
        </aside>

        <main style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
          }}>
            {filtered.map((it) => (
              <ItemCard key={it.id} item={it} onClick={() => setSelected(it)} />
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: 60, textAlign: 'center', color: '#666' }}>
                Niciun item găsit. Schimbă filtrele.
              </div>
            )}
          </div>
        </main>
      </div>

      {selected && <ItemModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CategoryButton(props: {
  icon: string; name: string; id: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      style={{
        width: '100%', padding: '8px 10px', marginBottom: 2,
        background: props.active ? '#1f1a08' : 'transparent',
        border: '1px solid', borderColor: props.active ? '#c9a227' : 'transparent',
        borderRadius: 4, color: props.active ? '#c9a227' : '#bbb',
        cursor: 'pointer', textAlign: 'left', fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span style={{ fontSize: 16 }}>{props.icon}</span>
      <span style={{ flex: 1 }}>{props.name}</span>
      <span style={{ fontSize: 11, color: '#666' }}>{props.count}</span>
    </button>
  );
}

function ItemCard({ item, onClick }: { item: CatalogItem; onClick: () => void }) {
  const glbSrc = item.glb ? `/models/${item.glb}` : undefined;
  return (
    <div
      onClick={onClick}
      style={{
        background: '#11111a', border: '1px solid #1f1f2a', borderRadius: 8,
        overflow: 'hidden', cursor: 'pointer', transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#c9a227';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#1f1f2a';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{
        height: 160, background: glbSrc ? '#0a0a0f' : item.color + '22',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {glbSrc ? (
          <model-viewer
            src={glbSrc}
            alt={item.name}
            camera-controls
            auto-rotate
            auto-rotate-delay="0"
            rotation-per-second="20deg"
            disable-zoom
            interaction-prompt="none"
            shadow-intensity="0.6"
            tone-mapping="commerce"
            exposure="1"
            style={{ width: '100%', height: '100%', background: 'transparent' }}
          />
        ) : (
          <div style={{ fontSize: 56, opacity: 0.85 }}>{item.icon}</div>
        )}
        {glbSrc && (
          <span style={{
            position: 'absolute', top: 8, right: 8,
            background: '#c9a227', color: '#0a0a0f', fontSize: 10, fontWeight: 700,
            padding: '2px 6px', borderRadius: 3, letterSpacing: 0.5,
          }}>3D REAL</span>
        )}
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: '#e8e8e8' }}>{item.name}</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
          {(item.width * 100).toFixed(0)} × {(item.depth * 100).toFixed(0)} × {(item.height * 100).toFixed(0)} cm
        </div>
        <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4, height: 28, overflow: 'hidden' }}>
          {item.description}
        </div>
      </div>
    </div>
  );
}

function ItemModal({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  const glbSrc = item.glb ? `/models/${item.glb}` : undefined;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0a0a0f', border: '1px solid #c9a227', borderRadius: 8,
          maxWidth: 1100, width: '100%', maxHeight: '90vh', display: 'flex', overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, background: '#0a0a0f', position: 'relative', minHeight: 500 }}>
          {glbSrc ? (
            <model-viewer
              src={glbSrc}
              alt={item.name}
              camera-controls
              auto-rotate
              auto-rotate-delay="2000"
              shadow-intensity="1"
              shadow-softness="0.7"
              tone-mapping="commerce"
              exposure="1"
              ar
              ar-modes="webxr scene-viewer quick-look"
              style={{ width: '100%', height: '100%', minHeight: 500, background: '#0a0a0f' }}
            >
              <button
                slot="ar-button"
                style={{
                  position: 'absolute', bottom: 16, right: 16,
                  background: '#c9a227', color: '#0a0a0f', border: 0,
                  padding: '10px 18px', borderRadius: 4, fontWeight: 700,
                  cursor: 'pointer', fontSize: 13, letterSpacing: 0.5,
                }}
              >
                👆 VEZI ÎN AR (mobil)
              </button>
            </model-viewer>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', height: '100%', minHeight: 500, color: '#666',
            }}>
              <div style={{ fontSize: 120, opacity: 0.3, marginBottom: 16 }}>{item.icon}</div>
              <div style={{ fontSize: 13, color: '#888' }}>Model 3D nedisponibil pt acest item</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Folosit ca placeholder procedural în editor</div>
            </div>
          )}
        </div>

        <aside style={{ width: 320, padding: 24, background: '#11111a', overflowY: 'auto', borderLeft: '1px solid #1f1f2a' }}>
          <button
            onClick={onClose}
            style={{
              float: 'right', background: 'transparent', border: 0, color: '#888',
              fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1,
            }}
          >×</button>
          <h2 style={{ margin: '0 0 8px 0', color: '#c9a227', fontSize: 22, fontFamily: 'Space Grotesk, Inter, sans-serif' }}>
            {item.name}
          </h2>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>{item.id}</div>

          <Spec label="Lățime" value={`${(item.width * 100).toFixed(0)} cm`} />
          <Spec label="Adâncime" value={`${(item.depth * 100).toFixed(0)} cm`} />
          <Spec label="Înălțime" value={`${(item.height * 100).toFixed(0)} cm`} />
          <Spec label="Clearance" value={`${(item.clearance * 100).toFixed(0)} cm`} />
          <Spec label="Categorie" value={item.category} />
          <Spec label="Culoare" value={item.color} swatch />

          <div style={{ marginTop: 16, padding: 12, background: '#1a1a24', borderRadius: 4, fontSize: 12, color: '#bbb', lineHeight: 1.5 }}>
            {item.description}
          </div>

          {glbSrc && (
            <div style={{ marginTop: 16, padding: 12, background: '#1f1a08', borderRadius: 4, fontSize: 11, color: '#c9a227', lineHeight: 1.5 }}>
              <strong>3D REAL</strong> — model GLB cu PBR la <code style={{ color: '#fff' }}>{glbSrc}</code>
              <br /><br />
              Drag = rotate · Scroll = zoom · Right-click = pan · Buton AR = vezi pe mobil în camera ta.
            </div>
          )}

          <Link
            href={`/?add=${item.id}`}
            style={{
              display: 'block', marginTop: 16, padding: '10px 14px',
              background: '#c9a227', color: '#0a0a0f', textAlign: 'center',
              borderRadius: 4, fontWeight: 700, fontSize: 13, textDecoration: 'none',
              letterSpacing: 0.5,
            }}
          >
            ➕ ADAUGĂ ÎN SCENĂ
          </Link>
        </aside>
      </div>
    </div>
  );
}

function Spec({ label, value, swatch }: { label: string; value: string; swatch?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1f1f2a', fontSize: 13 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: '#e8e8e8', display: 'flex', alignItems: 'center', gap: 6 }}>
        {swatch && <span style={{ width: 14, height: 14, background: value, borderRadius: 2, border: '1px solid #333' }} />}
        {value}
      </span>
    </div>
  );
}
