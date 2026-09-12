export default function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 to-navy-800">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white mb-4 animate-pulse">
          <img src="/kivu-ride-logo.png" alt="Kivu Ride" className="w-12 h-12 object-contain" />
        </div>
        <p className="text-brand-200/70 text-sm">Loading Kivu Daily…</p>
      </div>
    </div>
  );
}
