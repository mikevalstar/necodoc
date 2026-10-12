import type { Icon } from "@phosphor-icons/react";
import { type Editor, Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";

/** One entry of the Insert menu and the "/" menu. */
export type InsertItem = {
  title: string;
  icon: Icon;
  run: (editor: Editor) => void;
};

export type SlashState = {
  items: InsertItem[];
  index: number;
  rect: DOMRect | null;
  pick: (item: InsertItem) => void;
};

/** The open "/" menu. Lives outside React so the ProseMirror plugin can drive it. */
export class SlashMenu {
  state: SlashState | null = null;
  #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  get = () => this.state;

  set(state: SlashState | null) {
    this.state = state;
    for (const listener of this.#listeners) listener();
  }

  /** Arrow keys move, Enter picks, Escape closes. True when the menu used the key. */
  key(event: KeyboardEvent) {
    const { state } = this;
    if (!state) return false;
    const { items, index } = state;
    const move = (by: number) =>
      this.set({ ...state, index: (index + by + items.length) % items.length });
    switch (event.key) {
      case "ArrowDown":
        move(1);
        return true;
      case "ArrowUp":
        move(-1);
        return true;
      case "Enter": {
        const item = items[index];
        if (item) state.pick(item);
        return true;
      }
      case "Escape":
        this.set(null);
        return true;
      default:
        return false;
    }
  }
}

/** Typing "/" opens the insert menu at the cursor; the query filters it by title. */
export const SlashCommand = Extension.create<{ menu: SlashMenu | null; items: () => InsertItem[] }>(
  {
    name: "slashCommand",
    addOptions: () => ({ menu: null, items: () => [] }),
    addProseMirrorPlugins() {
      const { menu, items } = this.options;
      if (!menu) return [];
      const show = (props: SuggestionProps<InsertItem, InsertItem>) =>
        menu.set(
          props.items.length
            ? {
                items: props.items,
                index: 0,
                rect: props.clientRect?.() ?? null,
                pick: props.command,
              }
            : null,
        );
      return [
        Suggestion<InsertItem, InsertItem>({
          editor: this.editor,
          char: "/",
          items: ({ query }) =>
            items().filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor);
          },
          render: () => ({
            onStart: show,
            onUpdate: show,
            onKeyDown: ({ event }) => menu.key(event),
            onExit: () => menu.set(null),
          }),
        }),
      ];
    },
  },
);
