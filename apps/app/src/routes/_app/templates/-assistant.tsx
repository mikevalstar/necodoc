import { useChat } from "@ai-sdk/react";
import {
  type AppliedChange,
  type AssistantCall,
  type AssistantToolName,
  type AssistantToolOutput,
  appliedOutput,
  applyAssistantCall,
  assistantToolOutputSchema,
  type DesignedDraft,
  type DraftPart,
  designedDraftSchema,
  templateDiff,
  templateFieldProblems,
  toAssistantCall,
} from "@necodoc/shared";
import { useQuery } from "@tanstack/react-query";
import { getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { SendIcon, SparklesIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorAlert } from "@/components/form";
import { StructuralDiff } from "@/components/template-diff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AssistantMessage, assistantTransport } from "@/lib/api";
import { snippetsQuery } from "@/lib/queries";
import type { DesignedDraftValues } from "./-draft";

// Spec: docs/features/ai-template-assistant.md, ADR 0035. The chat panel: the model's tool calls
// arrive as proposals; the author applies or rejects each one here, and the answer goes back to
// the model. Nothing reaches the server's copy until the author saves.

const toolLabels: Record<AssistantToolName, string> = {
  setDetails: "Name & description",
  setFields: "Fields",
  editBody: "Content",
  setBand: "Header & footer",
  setCodeBody: "Body HTML",
  setCodeBand: "Header & footer HTML",
  setCss: "CSS",
  setPage: "Page & theme",
  setSampleData: "Sample data",
  setTranslations: "Translations",
};

const rejectedOutput: AssistantToolOutput = {
  status: "rejected",
  note: "The author rejected this change.",
};

/** Proposals applied in order, each on the result of the last; failures come back as notes. */
function applyAll(draft: DesignedDraft, calls: readonly AssistantCall[]) {
  let current = draft;
  const parts = new Set<DraftPart>();
  const results = calls.map((call): AssistantToolOutput => {
    const applied = applyAssistantCall(current, call);
    if (!applied.ok) return { status: "rejected", note: `Couldn't apply: ${applied.error}` };
    current = applied.draft;
    for (const part of applied.parts) parts.add(part);
    return appliedOutput;
  });
  return { draft: current, parts: [...parts], results };
}

export function AssistantPanel({
  templateId,
  draft,
  onApply,
  previewing,
  onPreview,
  build,
  onBuildSent,
  onClose,
}: {
  templateId: string;
  draft: DesignedDraftValues;
  onApply: (next: DesignedDraft, parts: DraftPart[]) => void;
  /** The tool call whose result the preview shows, if any. */
  previewing: string | null;
  onPreview: (preview: { id: string; draft: DesignedDraft } | null) => void;
  /** A description to build the template from, sent once on open. */
  build?: string;
  onBuildSent: () => void;
  onClose: () => void;
}) {
  const parsed = useMemo(() => designedDraftSchema.safeParse(draft), [draft]);
  /**
   * The draft the next request sends. Applying updates it at once: the answer can trigger the
   * next request before React re-renders with the merged draft.
   */
  const current = useRef(parsed);
  current.current = parsed;
  const applied = (next: DesignedDraft, parts: DraftPart[]) => {
    current.current = { success: true, data: next };
    onApply(next, parts);
  };
  const [transport] = useState(() =>
    assistantTransport(templateId, () => {
      const p = current.current;
      if (!p.success)
        throw new Error("Fix the draft's problems first; the assistant needs a valid draft.");
      return p.data;
    }),
  );
  const chat = useChat<AssistantMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const [input, setInput] = useState("");
  const busy = chat.status === "submitted" || chat.status === "streaming";

  const sentBuild = useRef(false);
  useEffect(() => {
    if (!build || sentBuild.current) return;
    // Deferred so StrictMode's mount-unmount-mount sends it once, from the mounted chat.
    const timer = setTimeout(() => {
      sentBuild.current = true;
      chat.sendMessage({ text: `Build this template from scratch: ${build}` });
      onBuildSent();
    }, 0);
    return () => clearTimeout(timer);
  }, [build, chat, onBuildSent]);

  const bottom = useRef<HTMLDivElement>(null);
  const lastMessage = chat.messages.at(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll as the reply grows
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [lastMessage, chat.status]);

  /** Proposals still waiting for an answer, in the order the model made them. */
  const pending = (lastMessage?.role === "assistant" ? lastMessage.parts : []).flatMap((part) => {
    if (!isToolUIPart(part) || part.state !== "input-available") return [];
    const call = toAssistantCall(getToolName(part), part.input);
    return call ? [{ id: part.toolCallId, call }] : [];
  });

  /** Answered here, so a re-render before the chat catches up can't apply a proposal twice. */
  const answered = useRef(new Set<string>());
  const answer = (call: AssistantCall, toolCallId: string, output: AssistantToolOutput) => {
    if (previewing === toolCallId) onPreview(null);
    chat.addToolOutput({ tool: call.tool, toolCallId, output });
  };
  const apply = (call: AssistantCall, toolCallId: string) => {
    const base = current.current;
    if (!base.success || answered.current.has(toolCallId)) return;
    answered.current.add(toolCallId);
    const result = applyAssistantCall(base.data, call);
    if (result.ok) applied(result.draft, result.parts);
    answer(
      call,
      toolCallId,
      result.ok ? appliedOutput : { status: "rejected", note: `Couldn't apply: ${result.error}` },
    );
  };
  const applyPending = () => {
    const base = current.current;
    const fresh = pending.filter((p) => !answered.current.has(p.id));
    if (!base.success || !fresh.length) return;
    for (const p of fresh) answered.current.add(p.id);
    const all = applyAll(
      base.data,
      fresh.map((p) => p.call),
    );
    if (all.parts.length) applied(all.draft, all.parts);
    for (const [i, p] of fresh.entries()) {
      answer(p.call, p.id, all.results[i] ?? rejectedOutput);
    }
  };
  /**
   * After "Apply all", the rest of this request's proposals apply as they arrive: the model
   * often proposes in steps (details and fields, then the body), and one click means all of it.
   * Sending a new message ends it.
   */
  const [autoApply, setAutoApply] = useState(false);
  const pendingIds = pending.map((p) => p.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when new proposals arrive
  useEffect(() => {
    if (autoApply && pendingIds) applyPending();
  }, [autoApply, pendingIds]);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setAutoApply(false);
    chat.sendMessage({ text });
    setInput("");
  };

  return (
    <section
      aria-label="AI assistant"
      className="flex h-[min(46svh,32rem)] flex-col rounded-lg border bg-background"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <SparklesIcon className="size-4" />
        <span className="font-medium">Assistant</span>
        <span className="truncate text-xs text-muted-foreground">
          The draft and this chat go to Anthropic (Claude). Review every change.
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Close the assistant"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {chat.messages.length === 0 && (
          <p className="text-muted-foreground">
            Describe the document, or ask for a change: "add a co-principal and show the second
            signature block only when there is one". Proposals show here for you to apply or reject;
            nothing changes until you do, and nothing is saved until you save.
          </p>
        )}
        {chat.messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap"
                  : "space-y-2"
              }
            >
              {message.parts.map((part, i) => {
                const key = `${message.id}:${i}`;
                if (part.type === "text") {
                  return (
                    <p key={key} className="whitespace-pre-wrap">
                      <Bold text={part.text} />
                    </p>
                  );
                }
                if (!isToolUIPart(part)) return null;
                const tool = getToolName(part);
                if (part.state === "input-streaming") {
                  return (
                    <p key={key} className="text-muted-foreground">
                      Writing a proposal…
                    </p>
                  );
                }
                if (part.state === "output-error") {
                  return (
                    <p key={key} className="text-xs text-muted-foreground">
                      The assistant made an invalid proposal and was told why: {part.errorText}
                    </p>
                  );
                }
                const call = toAssistantCall(tool, part.input);
                if (!call) return null;
                if (part.state === "output-available") {
                  const output = assistantToolOutputSchema.safeParse(part.output).data;
                  if (!output) return null;
                  return (
                    <div key={key} className="flex items-start gap-2 text-xs">
                      <Badge variant={output.status === "applied" ? "secondary" : "outline"}>
                        {output.status === "applied" ? "Applied" : "Rejected"}
                      </Badge>
                      <span className="text-muted-foreground">
                        {toolLabels[call.tool]}: {call.input.summary}
                        {output.status === "rejected" && output.note?.startsWith("Couldn't")
                          ? ` (${output.note})`
                          : ""}
                      </span>
                    </div>
                  );
                }
                if (part.state !== "input-available") return null;
                return (
                  <Proposal
                    key={key}
                    call={call}
                    draft={parsed.success ? parsed.data : null}
                    previewing={previewing === part.toolCallId}
                    onPreview={(next) =>
                      onPreview(next ? { id: part.toolCallId, draft: next } : null)
                    }
                    onApply={() => apply(call, part.toolCallId)}
                    onReject={(note) =>
                      answer(
                        call,
                        part.toolCallId,
                        note ? { status: "rejected", note } : rejectedOutput,
                      )
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
        {pending.length > 1 && !autoApply && (
          <Button
            size="sm"
            disabled={!parsed.success}
            title="Applies these and any further proposals for this request"
            onClick={() => {
              setAutoApply(true);
              applyPending();
            }}
          >
            Apply all {pending.length}
          </Button>
        )}
        {autoApply && busy && (
          <p className="text-muted-foreground">Applying the assistant's changes as they arrive…</p>
        )}
        {chat.status === "submitted" && <p className="text-muted-foreground">Thinking…</p>}
        <ErrorAlert error={chat.error ?? null} />
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          aria-label="Message the assistant"
          rows={2}
          className="min-h-0 resize-none"
          placeholder={
            pending.length ? "Apply or reject the proposals first…" : "Ask for a change…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Stop"
            onClick={() => chat.stop()}
          >
            <SquareIcon />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            disabled={!input.trim() || pending.length > 0}
          >
            <SendIcon />
          </Button>
        )}
      </form>
    </section>
  );
}

/** One proposal: what it changes against the draft as it is now, and the author's choice. */
function Proposal({
  call,
  draft,
  previewing,
  onPreview,
  onApply,
  onReject,
}: {
  call: AssistantCall;
  draft: DesignedDraft | null;
  previewing: boolean;
  onPreview: (draft: DesignedDraft | null) => void;
  onApply: () => void;
  /** With a note when the proposal couldn't apply. */
  onReject: (note?: string) => void;
}) {
  const snippets = useQuery(snippetsQuery).data;
  const applied: AppliedChange | null = useMemo(
    () => (draft ? applyAssistantCall(draft, call) : null),
    [draft, call],
  );
  const problems = useMemo(
    () =>
      applied?.ok
        ? [
            ...new Set(
              templateFieldProblems(applied.draft.content, applied.draft.sections, snippets).map(
                (p) => p.message,
              ),
            ),
          ]
        : [],
    [applied, snippets],
  );
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <Badge variant="outline">{toolLabels[call.tool]}</Badge>
        <span className="font-medium">{call.input.summary}</span>
      </div>
      {!applied ? (
        <p className="text-destructive">Fix the draft's problems before applying changes.</p>
      ) : !applied.ok ? (
        <p className="text-destructive">Can't apply: {applied.error}</p>
      ) : (
        <>
          {draft && (
            <StructuralDiff
              diff={templateDiff(draft, applied.draft)}
              baseVersion={null}
              caption="Compared with the draft as it is now."
            />
          )}
          {problems.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-amber-700 dark:text-amber-300">
              {problems.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {applied?.ok && (
          <>
            <Button size="sm" onClick={onApply}>
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPreview(previewing ? null : applied.draft)}
            >
              {previewing ? "Previewing" : "Preview"}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onReject(applied && !applied.ok ? `Couldn't apply: ${applied.error}` : undefined)
          }
        >
          {applied?.ok ? "Reject" : "Dismiss"}
        </Button>
      </div>
    </div>
  );
}

/** Models write **bold** whatever they're told; show it as bold rather than asterisks. */
function Bold({ text }: { text: string }) {
  const pieces = text.split(/\*\*(.+?)\*\*/g);
  let offset = 0;
  return pieces.map((piece, i) => {
    const key = offset;
    offset += piece.length + (i % 2 ? 4 : 0);
    return i % 2 ? <strong key={key}>{piece}</strong> : <span key={key}>{piece}</span>;
  });
}
