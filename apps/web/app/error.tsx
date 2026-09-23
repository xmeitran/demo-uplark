"use client";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="route-state-shell">
      <section className="route-state-card" role="alert">
        <p className="eyebrow">CRM route error</p>
        <h1>Could not render this workspace</h1>
        <p className="subtle">{error.message || "The route failed before the CRM shell could finish rendering."}</p>
        <button className="route-state-button" onClick={reset} type="button">
          Try again
        </button>
      </section>
    </main>
  );
}
