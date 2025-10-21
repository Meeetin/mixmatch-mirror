export default function TheaterBackground({ bgUrl, children }) {
  return (
    <div
      className="relative min-h-dvh w-full bg-black overflow-hidden"
      style={{ isolation: "isolate" }}
    >
      <img
        src={bgUrl}
        alt="Theater background"
        className="absolute inset-0 h-full w-full object-cover select-none pointer-events-none"
      />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(65% 65% at 50% 55%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.85) 100%), linear-gradient(90deg, rgba(0,0,0,0.6), transparent 22%, transparent 78%, rgba(0,0,0,0.6))",
        }}
      />

      {children}
    </div>
  );
}
