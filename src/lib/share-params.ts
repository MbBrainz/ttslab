export function getShareParams(): { text?: string; voice?: string } {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    text: params.get("text") ?? undefined,
    voice: params.get("voice") ?? undefined,
  };
}
