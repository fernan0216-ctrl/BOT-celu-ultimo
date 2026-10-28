// ============================================================================
// SCALP-OS · Hook de instrumentación: arranca el motor 24/7 en runtime Node.
// ============================================================================
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEngine } = await import("@/backend/engine");
    // boot() nunca lanza: cualquier fallo crítico deja el motor en FATAL.
    void startEngine();
  }
}
