import { type FieldSection, fieldSectionsSchema, sampleTemplateData } from "@necodoc/shared";
import { useState } from "react";
import { z } from "zod";
import { GuidedForm } from "@/components/guided-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

// Spec: docs/features/template-fields-and-guided-form.md (sample data): one data set per
// template, edited as the guided form or as JSON, used by every preview.

const objectSchema = z.record(z.string(), z.unknown());

export function SamplePanel({
  sections,
  sampleData,
  onChange,
  editable,
}: {
  sections: readonly FieldSection[];
  sampleData: Record<string, unknown>;
  onChange: (sampleData: Record<string, unknown>) => void;
  editable: boolean;
}) {
  /** Bumped to reload the form from `sampleData` after a change made outside it. */
  const [loads, setLoads] = useState(0);
  const [json, setJson] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const parsed = fieldSectionsSchema.safeParse(sections);

  if (!parsed.success) {
    return (
      <Alert>
        <AlertDescription>Fix the problems on the Fields tab to edit sample data.</AlertDescription>
      </Alert>
    );
  }
  const replace = (data: Record<string, unknown>) => {
    onChange(data);
    setLoads((n) => n + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {editable
            ? "The preview renders with this data. It's saved with the draft and published with it."
            : "Try data in the preview. You can't save it."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => replace(sampleTemplateData(parsed.data))}
        >
          Fill with examples
        </Button>
        <Button variant="ghost" size="sm" onClick={() => replace({})}>
          Clear
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setJsonError(null);
            setJson(json === null ? JSON.stringify(sampleData, null, 2) : null);
            setLoads((n) => n + 1);
          }}
        >
          {json === null ? "Edit as JSON" : "Edit as form"}
        </Button>
      </div>
      {json === null ? (
        <GuidedForm
          // A new key reloads the form; sections in the key keep its validator current.
          key={`${loads}:${JSON.stringify(parsed.data)}`}
          sections={parsed.data}
          defaultValues={sampleData}
          layout="all"
          revealErrors
          onChange={onChange}
        />
      ) : (
        <Field data-invalid={!!jsonError}>
          <FieldLabel htmlFor="sample-json">Sample data (JSON)</FieldLabel>
          <Textarea
            id="sample-json"
            rows={20}
            spellCheck={false}
            className="font-mono text-xs"
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              try {
                const data = objectSchema.safeParse(JSON.parse(e.target.value));
                setJsonError(data.success ? null : "Enter a JSON object, e.g. {}");
                if (data.success) onChange(data.data);
              } catch {
                setJsonError("Not valid JSON");
              }
            }}
          />
          <FieldDescription>
            Keys are field keys; repeating groups are lists of objects.
          </FieldDescription>
          {jsonError && <FieldError>{jsonError}</FieldError>}
        </Field>
      )}
    </div>
  );
}
