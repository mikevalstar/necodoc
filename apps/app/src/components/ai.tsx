import { SparkleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { meQuery } from "@/lib/auth";

// Spec: docs/features/ai-template-assistant.md. AI controls exist only when the API reports AI
// on (ANTHROPIC_KEY set, ADR 0022).

export const useAiEnabled = () => useQuery(meQuery).data?.capabilities.ai ?? false;

/**
 * "Suggest with AI" next to a text box: drafts text into it. The author's text is replaced only
 * when they click, and nothing saves until they do.
 */
export function SuggestButton({
  suggest,
  onSuggested,
  title = "Sends the template to Anthropic (Claude) and drafts the text. Edit it before saving.",
}: {
  suggest: () => Promise<string>;
  onSuggested: (text: string) => void;
  title?: string;
}) {
  const run = useMutation({ mutationFn: suggest, onSuccess: onSuggested });
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        title={title}
        disabled={run.isPending}
        onClick={() => run.mutate()}
      >
        <SparkleIcon />
        {run.isPending ? "Suggesting…" : "Suggest with AI"}
      </Button>
      {run.error && (
        <span role="alert" className="text-xs text-destructive">
          {run.error.message}
        </span>
      )}
    </span>
  );
}
