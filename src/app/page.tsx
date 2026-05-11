'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      color: '#e8e8e8',
      fontFamily: 'Inter, system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      gap: 24,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 64 }}>🚧</div>
      <h1 style={{
        margin: 0,
        fontSize: 32,
        color: '#c9a227',
        fontFamily: 'Space Grotesk, Inter, sans-serif',
        letterSpacing: 0.5,
      }}>
        Station Planner — În mentenanță
      </h1>
      <p style={{ maxWidth: 520, fontSize: 15, color: '#bbb', lineHeight: 1.6, margin: 0 }}>
        Editorul 3D este dezactivat temporar. Catalogul de modele 3D rămâne disponibil pentru browsing.
      </p>
      <Link
        href="/library"
        style={{
          background: '#c9a227',
          color: '#0a0a0f',
          padding: '14px 32px',
          borderRadius: 8,
          fontWeight: 700,
          fontSize: 15,
          textDecoration: 'none',
          letterSpacing: 0.5,
          marginTop: 8,
        }}
      >
        📚 Vezi catalog 3D →
      </Link>
      <div style={{ fontSize: 11, color: '#555', marginTop: 32 }}>
        UGA Aerial · Station Planner 3D
      </div>
    </div>
  );
}
