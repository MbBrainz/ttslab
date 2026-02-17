"use client";
import { Check, Link2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { APP_URL } from "@/lib/constants";

type ShareButtonProps = {
  modelSlug: string;
  text: string;
  voice?: string;
  comparisonSlug?: string;
};

export function ShareButton({ modelSlug, text, voice, comparisonSlug }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    const params = new URLSearchParams();
    if (text) params.set("text", text);
    if (voice && voice !== "default") params.set("voice", voice);

    const path = comparisonSlug
      ? `/compare/${comparisonSlug}`
      : `/models/${modelSlug}`;
    const url = `${APP_URL}${path}?${params.toString()}`;

    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [modelSlug, text, voice, comparisonSlug]);

  return (
    <Button variant="ghost" size="sm" onClick={handleShare} className="gap-1.5 text-xs">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Share"}
    </Button>
  );
}
