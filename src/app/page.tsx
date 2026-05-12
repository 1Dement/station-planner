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
      <div style={{ fontSize: 72 }}>🚧</div>
      <h1 style={{
        margin: 0,
        fontSize: 36,
        color: '#c9a227',
        fontFamily: 'Space Grotesk, Inter, sans-serif',
        letterSpacing: 0.5,
        maxWidth: 720,
        lineHeight: 1.3,
      }}>
        Mentenanță Site — Reorganizare Stație
      </h1>
      <p style={{ fontSize: 18, color: '#bbb', margin: 0 }}>
        Revenim curând.
      </p>
      <div style={{ fontSize: 11, color: '#555', marginTop: 32 }}>
        UGA Aerial
      </div>
    </div>
  );
}
