import { type Condition, conditionSchema } from "@necodoc/shared";
import { GitForkIcon, RepeatIcon, SelectionSlashIcon, TrashIcon } from "@phosphor-icons/react";
import { mergeAttributes, Node } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { ReactNode } from "react";
import { ConditionEditor } from "@/components/condition-editor";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { enclosingRepeat, groupFields, scalarChoices, useEditorFields } from "./context";

// ADR 0016's structure nodes: block wrappers compiled to {% if %} and {% for %}, and a page
// break. Attrs mirror conditionalSectionNodeSchema / repeatingSectionNodeSchema in
// packages/shared/src/template-doc.ts.

const parseJson = (raw: string | null): unknown => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const ConditionalSection = Node.create({
  name: "conditionalSection",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      condition: {
        default: null,
        parseHTML: (el) =>
          conditionSchema.safeParse(parseJson(el.getAttribute("data-condition"))).data ?? null,
        renderHTML: (attrs) => ({ "data-condition": JSON.stringify(attrs.condition) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-conditional-section]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-conditional-section": "" }, HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ConditionalView);
  },
});

export const RepeatingSection = Node.create({
  name: "repeatingSection",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      field: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-repeat") ?? "",
        renderHTML: (attrs) => ({ "data-repeat": attrs.field }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-repeating-section]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-repeating-section": "" }, HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RepeatingView);
  },
});

/** Compiles to `break-before: page`. Shown as a labelled rule (styled in index.css). */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return ["div", { "data-page-break": "" }];
  },
});

/** Replaces a wrapper with its content, keeping what's inside. */
function unwrap({ editor, getPos, node }: ReactNodeViewProps) {
  const pos = getPos();
  if (typeof pos !== "number") return;
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(pos, pos + node.nodeSize, node.content);
      return true;
    })
    .run();
}

function Wrapper({
  props,
  tone,
  icon,
  children,
}: {
  props: ReactNodeViewProps;
  tone: "amber" | "violet";
  icon: ReactNode;
  children: ReactNode;
}) {
  const editable = props.editor.isEditable;
  return (
    <NodeViewWrapper
      className={cn(
        "my-3 rounded-lg border border-dashed",
        tone === "amber" ? "border-amber-500/60" : "border-violet-500/60",
      )}
    >
      <div
        contentEditable={false}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-t-lg px-2 py-1.5 text-xs",
          tone === "amber" ? "bg-amber-500/10" : "bg-violet-500/10",
        )}
      >
        {icon}
        {children}
        {editable && (
          <div className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              title="Remove the wrapper, keep the content"
              aria-label="Remove the wrapper, keep the content"
              onClick={() => unwrap(props)}
            >
              <SelectionSlashIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Delete the section and its content"
              aria-label="Delete the section and its content"
              onClick={props.deleteNode}
            >
              <TrashIcon />
            </Button>
          </div>
        )}
      </div>
      <NodeViewContent className="px-3 py-1" />
    </NodeViewWrapper>
  );
}

function ConditionalView(props: ReactNodeViewProps) {
  const { sections } = useEditorFields();
  const { editor, getPos, node, updateAttributes } = props;
  const pos = getPos();
  const repeat = typeof pos === "number" ? enclosingRepeat(editor.state.doc.resolve(pos)) : null;
  const condition: Condition | null = conditionSchema.safeParse(node.attrs.condition).data ?? null;
  return (
    <Wrapper props={props} tone="amber" icon={<GitForkIcon className="size-3.5 text-amber-600" />}>
      <span className="font-medium">Show only if</span>
      <ConditionEditor
        id={`condition-${pos}`}
        value={condition}
        onChange={(next) => updateAttributes({ condition: next })}
        fields={scalarChoices(sections, repeat)}
        disabled={!editor.isEditable}
      />
    </Wrapper>
  );
}

function RepeatingView(props: ReactNodeViewProps) {
  const { sections } = useEditorFields();
  const { editor, node, updateAttributes } = props;
  const groups = groupFields(sections);
  const field = typeof node.attrs.field === "string" ? node.attrs.field : "";
  const known = groups.some((g) => g.key === field);
  return (
    <Wrapper props={props} tone="violet" icon={<RepeatIcon className="size-3.5 text-violet-600" />}>
      <span className="font-medium">Repeat for each</span>
      <NativeSelect
        size="sm"
        aria-label="Repeating group"
        aria-invalid={!known}
        disabled={!editor.isEditable}
        value={field}
        onChange={(e) => updateAttributes({ field: e.target.value })}
      >
        {!known && (
          <NativeSelectOption value={field}>
            {field ? `Missing group "${field}"` : "Pick a repeating group"}
          </NativeSelectOption>
        )}
        {groups.map((g) => (
          <NativeSelectOption key={g.key} value={g.key}>
            {g.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <span className="text-muted-foreground">
        Inside, merge fields can use the group's fields.
      </span>
    </Wrapper>
  );
}
