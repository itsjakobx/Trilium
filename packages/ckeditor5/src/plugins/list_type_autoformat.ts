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
 *
 * Indent and outdent copy `listType` from the previous same-indent sibling, and stock
 * `indentList` refuses to run when that sibling is a different type — so Tab dies after
 * a mixed-type Shift+Tab. An item that already has content keeps its type; an empty item
 * still adapts. Tab next to a different-type sibling is enabled.
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

        const indentList = editor.commands.get("indentList");
        const outdentList = editor.commands.get("outdentList");
        /* v8 ignore next 3 -- `List` is required, so both indent commands are registered */
        if (!indentList || !outdentList) {
            return;
        }
        wrapListIndentCommandToPreserveType(editor, indentList);
        wrapListIndentCommandToPreserveType(editor, outdentList);
        wrapIndentListToAllowMixedTypes(editor, indentList);
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

/**
 * Stock `ListIndentCommand` copies `listType` from the previous same-indent sibling after
 * every indent or outdent. Restore the type of any item that already had content, in the
 * same change so undo stays one step.
 */
function wrapListIndentCommandToPreserveType(editor: Editor, command: Command): void {
    const originalExecute = command.execute.bind(command);
    command.execute = ((...args: unknown[]) => {
        const preserved = collectContentfulListTypes(editor);
        if (preserved.size === 0) {
            originalExecute(...args);
            return;
        }

        editor.model.change((writer) => {
            originalExecute(...args);
            restoreListTypes(writer, editor, preserved);
        });
    }) as typeof command.execute;
}

/**
 * Stock `indentList` is disabled when the previous same-indent sibling has a different
 * `listType`. Tab then does nothing (or falls through to block indent). Enable it so a
 * mixed-type item can nest under the item above.
 */
function wrapIndentListToAllowMixedTypes(editor: Editor, command: Command): void {
    const originalRefresh = command.refresh.bind(command);
    command.refresh = (() => {
        originalRefresh();
        if (!command.isEnabled && hasPreviousItemAtSameIndent(editor)) {
            command.isEnabled = true;
        }
    }) as typeof command.refresh;
}

function hasPreviousItemAtSameIndent(editor: Editor): boolean {
    const block = getSelectedListBlock(editor);
    if (!block) {
        return false;
    }
    const first = getItemBlocks(block)[0];
    const indent = first.getAttribute("listIndent");
    /* v8 ignore next 3 -- a list block always carries a numeric `listIndent` */
    if (typeof indent !== "number") {
        return false;
    }

    for (
        let prev = first.previousSibling;
        isListBlock(prev);
        prev = prev.previousSibling
    ) {
        const prevIndent = prev.getAttribute("listIndent");
        if (prevIndent === indent) {
            return true;
        }
        if (typeof prevIndent === "number" && prevIndent < indent) {
            return false;
        }
    }
    return false;
}

function collectContentfulListTypes(editor: Editor): Map<string, string> {
    const preserved = new Map<string, string>();
    const root = editor.model.document.getRoot();
    /* v8 ignore next 3 -- a live editor always has a root */
    if (!root) {
        return preserved;
    }

    visitListBlocks(root, (block) => {
        const itemId = block.getAttribute("listItemId");
        /* v8 ignore next 3 -- `listItemId` is always a string on a list block */
        if (typeof itemId !== "string") {
            return;
        }
        if (preserved.has(itemId)) {
            return;
        }
        if (!itemHasContent(getItemBlocks(block))) {
            return;
        }
        const type = block.getAttribute("listType");
        /* v8 ignore next 3 -- `listType` is always a string on a list block */
        if (typeof type !== "string") {
            return;
        }
        preserved.set(itemId, type);
    });
    return preserved;
}

function restoreListTypes(
    writer: ModelWriter,
    editor: Editor,
    preserved: Map<string, string>
): void {
    const root = editor.model.document.getRoot();
    /* v8 ignore next 3 -- a live editor always has a root */
    if (!root) {
        return;
    }

    visitListBlocks(root, (block) => {
        const itemId = block.getAttribute("listItemId");
        /* v8 ignore next 3 -- `listItemId` is always a string on a list block */
        if (typeof itemId !== "string") {
            return;
        }
        const type = preserved.get(itemId);
        if (type === undefined || block.getAttribute("listType") === type) {
            return;
        }
        writer.setAttribute("listType", type, block);
    });
}

function visitListBlocks(node: ModelElement, visit: (block: ModelElement) => void): void {
    for (const child of node.getChildren()) {
        if (!child.is("element")) {
            continue;
        }
        if (child.hasAttribute("listItemId")) {
            visit(child);
        } else {
            visitListBlocks(child, visit);
        }
    }
}

function itemHasContent(blocks: ModelElement[]): boolean {
    for (const block of blocks) {
        if (!block.isEmpty) {
            return true;
        }
    }
    return false;
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
