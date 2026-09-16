import {
    Autoformat,
    Command,
    Delete,
    List,
    Plugin,
    type Editor,
    type ModelDocumentChangeEvent,
    type ModelElement,
    type ModelNode,
    type ModelWriter
} from "ckeditor5";

const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";
const TASK_STATE_ATTRIBUTE = "taskState";

type ListType = "bulleted" | "numbered" | "todo";

interface SwitchOptions {
    listStart?: number;
    checked?: boolean;
}

type ListTypeCommand = Command & {
    type: string;
};

/**
 * Switching list type on one row — by typing a markdown marker, or by the toolbar / list
 * command while the caret is in that item — leaves items of the old type around it alone.
 * Upstream Autoformat and `ListCommand` both rewrite every same-indent sibling of the same
 * type; this plugin intercepts those two paths.
 */
export default class ListTypeAutoformat extends Plugin {

    static get requires() {
        return [Autoformat, List] as const;
    }

    static get pluginName() {
        return "ListTypeAutoformat" as const;
    }

    init() {
        const editor = this.editor;
        const autoformat = editor.plugins.get(Autoformat);

        // Registered in `init()` so this listener runs before Autoformat's `afterInit` rules.
        this.listenTo<ModelDocumentChangeEvent>(
            editor.model.document,
            "change:data",
            (_evt, batch) => {
                if (!autoformat.isEnabled) {
                    return;
                }
                switchListTypeOnTypedMarker(editor, batch);
            }
        );

        for (const name of [ "bulletedList", "numberedList", "todoList" ] as const) {
            const command = editor.commands.get(name);
            if (!command) {
                continue;
            }
            wrapListCommandToCurrentItem(editor, command as ListTypeCommand);
        }
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [ListTypeAutoformat.pluginName]: ListTypeAutoformat;
    }
}

/**
 * Consumes a markdown list marker typed at the start of a list item of a different type and
 * retargets only that item. No-op for paragraphs (stock Autoformat still creates a list) and
 * for a marker that matches the item's current type (the characters stay).
 */
function switchListTypeOnTypedMarker(
    editor: Editor,
    batch: { isUndo: boolean; isLocal: boolean }
): void {
    if (batch.isUndo) {
        return;
    }
    /* v8 ignore next 3 -- non-local batches only exist under collaboration */
    if (!batch.isLocal) {
        return;
    }

    const range = editor.model.document.selection.getFirstRange();
    /* v8 ignore next 3 -- a live editor always has a document selection range */
    if (!range) {
        return;
    }
    if (!range.isCollapsed) {
        return;
    }

    const changes = Array.from(editor.model.document.differ.getChanges());
    const entry = changes[0];
    if (
        changes.length !== 1 ||
        !entry ||
        entry.type !== "insert" ||
        entry.name !== "$text" ||
        entry.length !== 1
    ) {
        return;
    }

    const blockToFormat = entry.position.parent;
    /* v8 ignore next 3 -- a `$text` insert always lands in an element */
    if (!blockToFormat.is("element")) {
        return;
    }
    if (blockToFormat.is("element", "codeBlock")) {
        return;
    }
    if (!blockToFormat.hasAttribute("listItemId")) {
        return;
    }

    const firstNode = blockToFormat.getChild(0);
    if (!firstNode || !firstNode.is("$text")) {
        return;
    }

    const firstNodeRange = editor.model.createRangeOn(firstNode);
    if (!firstNodeRange.containsRange(range) && !range.end.isEqual(firstNodeRange.end)) {
        return;
    }

    const matched = matchTypedMarker(firstNode.data.substring(0, range.end.offset));
    if (!matched) {
        return;
    }
    if (blockToFormat.getAttribute("listType") === matched.type) {
        return;
    }

    // Nested into this `change:data` turn so Autoformat's later listener sees more than one
    // differ entry and does not also fire (which would rewrite the whole list).
    editor.model.change((writer) => {
        if (!isFirstBlockOfListItem(blockToFormat)) {
            editor.execute("splitListItemBefore");
        }

        for (const itemBlock of getItemBlocks(blockToFormat)) {
            applyListType(writer, itemBlock, matched.type, matched.options, editor);
        }

        const start = writer.createPositionAt(blockToFormat, 0);
        const end = writer.createPositionAt(blockToFormat, matched.length);
        writer.remove(writer.createRange(start, end));
    });

    editor.model.enqueueChange(() => {
        editor.plugins.get(Delete).requestUndoOnBackspace();
    });
}

type ListExecuteOptions = {
    forceValue?: boolean;
    additionalAttributes?: Record<string, unknown>;
};

/**
 * Stock `ListCommand` with a collapsed caret walks every same-indent sibling of the same type.
 * A type change from the toolbar should retarget only the item the caret is in.
 */
function wrapListCommandToCurrentItem(editor: Editor, command: ListTypeCommand): void {
    const originalExecute = command.execute.bind(command);
    command.execute = ((options: ListExecuteOptions = {}) => {
        if (!shouldRetargetCurrentItem(editor, command, options)) {
            originalExecute(options);
            return;
        }

        const block = getSelectedListBlock(editor);
        /* v8 ignore next 4 -- `shouldRetargetCurrentItem` already required a list block */
        if (!block) {
            originalExecute(options);
            return;
        }

        const extra: SwitchOptions = {};
        const listStart = options.additionalAttributes?.listStart;
        if (typeof listStart === "number") {
            extra.listStart = listStart;
        }
        if (command.type === "todo") {
            extra.checked = false;
        }

        const changed = getItemBlocks(block);
        editor.model.change((writer) => {
            for (const itemBlock of changed) {
                applyListType(writer, itemBlock, command.type, extra, editor);
                if (options.additionalAttributes) {
                    writer.setAttributes(options.additionalAttributes, itemBlock);
                }
            }
            command.fire("afterExecute", changed);
        });
    }) as typeof command.execute;
}

function shouldRetargetCurrentItem(
    editor: Editor,
    command: ListTypeCommand,
    options: ListExecuteOptions
): boolean {
    const turnOff = options.forceValue !== undefined ? !options.forceValue : command.value;
    if (turnOff) {
        return false;
    }
    if (!editor.model.document.selection.isCollapsed) {
        return false;
    }
    const block = getSelectedListBlock(editor);
    if (!block) {
        return false;
    }
    return block.getAttribute("listType") !== command.type;
}

function getSelectedListBlock(editor: Editor): ModelElement | null {
    const parent = editor.model.document.selection.getFirstPosition()?.parent;
    if (parent && parent.is("element") && parent.hasAttribute("listItemId")) {
        return parent;
    }
    return null;
}

function matchTypedMarker(
    prefix: string
): { type: ListType; length: number; options: SwitchOptions } | null {
    const numbered = /^(\d+)[.|)]\s$/.exec(prefix);
    if (numbered) {
        return {
            type: "numbered",
            length: numbered[0].length,
            options: { listStart: Number.parseInt(numbered[0], 10) }
        };
    }
    if (/^[*-]\s$/.test(prefix)) {
        return { type: "bulleted", length: prefix.length, options: {} };
    }
    if (/^\[\s?x\s?\]\s$/.test(prefix)) {
        return { type: "todo", length: prefix.length, options: { checked: true } };
    }
    if (/^\[\s?\]\s$/.test(prefix)) {
        return { type: "todo", length: prefix.length, options: { checked: false } };
    }
    return null;
}

function applyListType(
    writer: ModelWriter,
    block: ModelElement,
    type: string,
    options: SwitchOptions,
    editor: Editor
): void {
    writer.setAttribute("listType", type, block);

    if (type === "todo") {
        if (options.checked) {
            writer.setAttribute(TODO_LIST_CHECKED_ATTRIBUTE, true, block);
        } else {
            writer.removeAttribute(TODO_LIST_CHECKED_ATTRIBUTE, block);
        }
    } else {
        writer.removeAttribute(TODO_LIST_CHECKED_ATTRIBUTE, block);
        writer.removeAttribute(TASK_STATE_ATTRIBUTE, block);
    }

    if (type === "numbered") {
        if (options.listStart !== undefined && editor.commands.get("listStart")) {
            writer.setAttribute("listStart", options.listStart, block);
        }
    } else {
        writer.removeAttribute("listStart", block);
        writer.removeAttribute("listReversed", block);
    }
}

/**
 * Consecutive blocks of this list item. Walks back to the first block so a caret in a
 * continuation paragraph still retargets the whole item.
 */
function getItemBlocks(block: ModelElement): ModelElement[] {
    const itemId = block.getAttribute("listItemId");
    let start = block;
    for (
        let prev = block.previousSibling;
        isListBlock(prev) && prev.getAttribute("listItemId") === itemId;
        prev = prev.previousSibling
    ) {
        start = prev;
    }
    const blocks = [start];
    for (
        let next = start.nextSibling;
        isListBlock(next) && next.getAttribute("listItemId") === itemId;
        next = next.nextSibling
    ) {
        blocks.push(next);
    }
    return blocks;
}

function isFirstBlockOfListItem(block: ModelElement): boolean {
    const prev = block.previousSibling;
    return !isListBlock(prev) ||
        prev.getAttribute("listItemId") !== block.getAttribute("listItemId");
}

function isListBlock(node: ModelNode | null): node is ModelElement {
    return !!node && node.is("element") && node.hasAttribute("listItemId");
}
