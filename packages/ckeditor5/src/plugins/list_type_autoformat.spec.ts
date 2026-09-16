import {
    Autoformat,
    ClassicEditor,
    CodeBlock,
    Essentials,
    List,
    ListProperties,
    Paragraph,
    TodoList,
    _setModelData as setModelData,
    type ModelElement
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import ListTypeAutoformat from "./list_type_autoformat.js";
import TodoListMultistateEditing, {
    TASK_STATE_ATTRIBUTE
} from "./todo_list_multistate/todo_list_multistate_editing.js";

const TODO_LIST_CHECKED_ATTRIBUTE = "todoListChecked";

const THREE_BULLETS =
    '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
    '<paragraph listIndent="0" listItemId="b" listType="bulleted">[]B</paragraph>' +
    '<paragraph listIndent="0" listItemId="c" listType="bulleted">C</paragraph>';

async function createEditor(
    extraPlugins: unknown[] = [],
    extraConfig: Record<string, unknown> = {}
): Promise<ClassicEditor> {
    return await createTestEditor(
        [ Essentials, Paragraph, List, TodoList, Autoformat, ListTypeAutoformat, ...extraPlugins ],
        extraConfig
    );
}

/** Type `text` into the editor one character at a time, as real typing (and thus autoformat) would. */
function type(editor: ClassicEditor, text: string): void {
    for (const ch of text) {
        editor.execute("insertText", { text: ch });
    }
}

function getBlock(editor: ClassicEditor, index: number): ModelElement {
    const child = editor.model.document.getRoot()?.getChild(index);
    if (!child || !child.is("element")) {
        throw new Error(`No element block at index ${index}.`);
    }
    return child;
}

function listTypes(editor: ClassicEditor): Array<unknown> {
    const root = editor.model.document.getRoot();
    if (!root) {
        return [];
    }
    const types: unknown[] = [];
    for (let i = 0; i < root.childCount; i++) {
        const child = root.getChild(i);
        types.push(child && child.is("element") ? child.getAttribute("listType") : undefined);
    }
    return types;
}

describe("ListTypeAutoformat", () => {
    describe("without the plugin (stock Autoformat)", () => {
        it("converts the whole same-indent run when typing `1. ` in a bullet", async () => {
            const editor = await createTestEditor([ Essentials, Paragraph, List, Autoformat ]);
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "1. ");
            expect(listTypes(editor)).toEqual([ "numbered", "numbered", "numbered" ]);
        });

        it("converts the whole same-indent run when executing numberedList", async () => {
            const editor = await createTestEditor([ Essentials, Paragraph, List, TodoList ]);
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("numberedList");
            expect(listTypes(editor)).toEqual([ "numbered", "numbered", "numbered" ]);
        });

        it("copies list type from the previous sibling when outdenting a nested item", async () => {
            const editor = await createTestEditor([ Essentials, Paragraph, List ]);
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]B</paragraph>');
            editor.execute("outdentList");
            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(0);
        });

        it("disables indentList when the previous sibling is a different list type", async () => {
            const editor = await createTestEditor([ Essentials, Paragraph, List ]);
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="numbered">[]B</paragraph>');
            expect(editor.commands.get("indentList")?.isEnabled).toBe(false);
        });
    });

    describe("with the plugin", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createEditor();
        });

        it("loads the plugin", () => {
            expect(editor.plugins.get(ListTypeAutoformat)).toBeInstanceOf(ListTypeAutoformat);
            expect(ListTypeAutoformat.requires).toContain(Autoformat);
            expect(ListTypeAutoformat.requires).toContain(List);
            expect(ListTypeAutoformat.pluginName).toBe("ListTypeAutoformat");
        });

        it("turns only the current bullet into a numbered item when typing `1. `", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "1. ");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "bulleted" ]);
            expect(getBlock(editor, 1).getChild(0)?.data).toBe("B");
        });

        it("turns only the current numbered item into a bullet when typing `- `", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="numbered">A</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="numbered">[]B</paragraph>' +
                '<paragraph listIndent="0" listItemId="c" listType="numbered">C</paragraph>');
            type(editor, "- ");

            expect(listTypes(editor)).toEqual([ "numbered", "bulleted", "numbered" ]);
        });

        it("turns only the current numbered item into a bullet when typing `* `", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="numbered">[]A</paragraph>');
            type(editor, "* ");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
        });

        it("turns only the current bullet into a todo when typing `[ ] `", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "[ ] ");

            expect(listTypes(editor)).toEqual([ "bulleted", "todo", "bulleted" ]);
            expect(getBlock(editor, 1).hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("turns only the current bullet into a checked todo when typing `[x] `", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "[x] ");

            expect(listTypes(editor)).toEqual([ "bulleted", "todo", "bulleted" ]);
            expect(getBlock(editor, 1).getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        });

        it("accepts `1)` as a numbered marker", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "1) ");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "bulleted" ]);
        });

        it("leaves the characters when the marker matches the current type", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]A</paragraph>');
            type(editor, "- ");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
            expect(getBlock(editor, 0).getChild(0)?.data).toBe("- A");
        });

        it("still lets stock Autoformat create a list from a paragraph", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            type(editor, "1. ");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("numbered");
            expect(getBlock(editor, 0).isEmpty).toBe(true);
        });

        it("does not rewrite a nested child when the parent item switches type", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="bulleted">Child</paragraph>' +
                '<paragraph listIndent="0" listItemId="c" listType="bulleted">C</paragraph>');
            type(editor, "1. ");

            expect(listTypes(editor)).toEqual([ "numbered", "bulleted", "bulleted" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(1);
        });

        it("splits a continuation block off into a new numbered item", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">First</paragraph>' +
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]</paragraph>' +
                '<paragraph listIndent="0" listItemId="c" listType="bulleted">C</paragraph>');
            type(editor, "1. ");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "bulleted" ]);
            expect(getBlock(editor, 0).getAttribute("listItemId"))
                .not.toBe(getBlock(editor, 1).getAttribute("listItemId"));
            expect(getBlock(editor, 1).isEmpty).toBe(true);
        });

        it("switches every block of a multi-block item when typed in the first block", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]First</paragraph>' +
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">Second</paragraph>' +
                '<paragraph listIndent="0" listItemId="c" listType="bulleted">C</paragraph>');
            type(editor, "1. ");

            expect(listTypes(editor)).toEqual([ "numbered", "numbered", "bulleted" ]);
            expect(getBlock(editor, 0).getAttribute("listItemId"))
                .toBe(getBlock(editor, 1).getAttribute("listItemId"));
        });

        it("drops todo checked state when switching away from a todo", () => {
            setModelData(editor.model,
                `<paragraph listIndent="0" listItemId="a" listType="todo" ${TODO_LIST_CHECKED_ATTRIBUTE}="true">[]A</paragraph>` +
                '<paragraph listIndent="0" listItemId="b" listType="todo">B</paragraph>');
            type(editor, "- ");

            expect(listTypes(editor)).toEqual([ "bulleted", "todo" ]);
            expect(getBlock(editor, 0).hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("drops numbered start/reversed when switching away from a numbered item", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="numbered" listStart="3" listReversed="true">[]A</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="numbered">B</paragraph>');
            type(editor, "- ");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
            expect(getBlock(editor, 0).hasAttribute("listStart")).toBe(false);
            expect(getBlock(editor, 0).hasAttribute("listReversed")).toBe(false);
            expect(getBlock(editor, 1).getAttribute("listType")).toBe("numbered");
        });

        it("does not switch when Autoformat is disabled", () => {
            editor.plugins.get(Autoformat).forceDisabled("test");
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "1. ");

            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted", "bulleted" ]);
            expect(getBlock(editor, 1).getChild(0)?.data).toBe("1. B");
        });

        it("does not switch when the selection is not collapsed", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">Hello</paragraph>');
            editor.model.change((writer) => {
                const block = getBlock(editor, 0);
                writer.insertText("x", writer.createPositionAt(block, 0));
                writer.setSelection(writer.createRangeIn(block));
            });

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
        });

        it("does not switch on a multi-character insert", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("insertText", { text: "1. " });

            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted", "bulleted" ]);
        });

        it("accepts `[] ` without an inner space as an unchecked todo marker", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "[] ");

            expect(listTypes(editor)).toEqual([ "bulleted", "todo", "bulleted" ]);
            expect(getBlock(editor, 1).hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("accepts `[ x ] ` as a checked todo marker", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "[ x ] ");

            expect(listTypes(editor)).toEqual([ "bulleted", "todo", "bulleted" ]);
            expect(getBlock(editor, 1).getAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(true);
        });

        it("does not switch when the caret is not in the first text node", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">Hi<softBreak></softBreak>[]</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="bulleted">B</paragraph>');
            type(editor, "1. ");

            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted" ]);
        });

        it("does not switch when the first child of the block is not text", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted"><softBreak></softBreak>[]</paragraph>');
            type(editor, "1. ");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
        });

        it("does not switch on text that is not a list marker", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "foo ");

            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted", "bulleted" ]);
        });

        it("undo restores the original list type", () => {
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "1. ");
            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "bulleted" ]);

            editor.execute("undo");
            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted", "bulleted" ]);
        });
    });

    describe("with ListProperties", () => {
        it("sets listStart from a typed numbered marker", async () => {
            const editor = await createEditor([ ListProperties ], {
                list: { properties: { styles: true, startIndex: true, reversed: true } }
            });
            setModelData(editor.model, THREE_BULLETS);
            type(editor, "3. ");

            expect(getBlock(editor, 1).getAttribute("listType")).toBe("numbered");
            expect(getBlock(editor, 1).getAttribute("listStart")).toBe(3);
            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
        });
    });

    describe("with TodoListMultistateEditing", () => {
        it("drops taskState when switching away from a todo", async () => {
            const editor = await createEditor([ TodoListMultistateEditing ]);
            setModelData(editor.model,
                `<paragraph listIndent="0" listItemId="a" listType="todo" ${TASK_STATE_ATTRIBUTE}="doing">[]A</paragraph>` +
                '<paragraph listIndent="0" listItemId="b" listType="todo">B</paragraph>');
            type(editor, "1. ");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("numbered");
            expect(getBlock(editor, 0).hasAttribute(TASK_STATE_ATTRIBUTE)).toBe(false);
            expect(getBlock(editor, 1).getAttribute("listType")).toBe("todo");
        });
    });

    describe("inside a code block", () => {
        it("does not switch a list-item code block", async () => {
            const editor = await createEditor([ CodeBlock ]);
            setModelData(editor.model,
                '<codeBlock language="plaintext" listIndent="0" listItemId="a" listType="bulleted">[]x</codeBlock>' +
                '<paragraph listIndent="0" listItemId="b" listType="bulleted">B</paragraph>');
            type(editor, "1. ");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
            expect(getBlock(editor, 0).is("element", "codeBlock")).toBe(true);
            expect(getBlock(editor, 1).getAttribute("listType")).toBe("bulleted");
        });
    });

    describe("toolbar / list command", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createEditor();
        });

        it("turns only the current item into numbered when executing numberedList", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("numberedList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "bulleted" ]);
        });

        it("turns only the current item into a todo when executing todoList", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("todoList");

            expect(listTypes(editor)).toEqual([ "bulleted", "todo", "bulleted" ]);
            expect(getBlock(editor, 1).hasAttribute(TODO_LIST_CHECKED_ATTRIBUTE)).toBe(false);
        });

        it("turns only the current numbered item into a bullet when executing bulletedList", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="numbered">A</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="numbered">[]B</paragraph>' +
                '<paragraph listIndent="0" listItemId="c" listType="numbered">C</paragraph>');
            editor.execute("bulletedList");

            expect(listTypes(editor)).toEqual([ "numbered", "bulleted", "numbered" ]);
        });

        it("still turns a paragraph into a list", () => {
            setModelData(editor.model, "<paragraph>[]Hello</paragraph>");
            editor.execute("numberedList");

            expect(getBlock(editor, 0).getAttribute("listType")).toBe("numbered");
        });

        it("still toggles the current item off when executing the same list type", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("bulletedList");

            expect(getBlock(editor, 1).hasAttribute("listItemId")).toBe(false);
            expect(listTypes(editor)[0]).toBe("bulleted");
            expect(listTypes(editor)[2]).toBe("bulleted");
        });

        it("still converts every selected item when the selection spans more than one", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.model.change((writer) => {
                writer.setSelection(writer.createRange(
                    writer.createPositionAt(getBlock(editor, 0), 0),
                    writer.createPositionAt(getBlock(editor, 1), "end")
                ));
            });
            editor.execute("numberedList");

            expect(listTypes(editor)).toEqual([ "numbered", "numbered", "bulleted" ]);
        });

        it("retargets every block of a multi-block item when the caret is in a continuation", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">First</paragraph>' +
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]Second</paragraph>' +
                '<paragraph listIndent="0" listItemId="c" listType="bulleted">C</paragraph>');
            editor.execute("numberedList");

            expect(listTypes(editor)).toEqual([ "numbered", "numbered", "bulleted" ]);
            expect(getBlock(editor, 0).getAttribute("listItemId"))
                .toBe(getBlock(editor, 1).getAttribute("listItemId"));
        });

        it("does not rewrite a nested child when the parent item is retargeted", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">[]A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="bulleted">Child</paragraph>' +
                '<paragraph listIndent="0" listItemId="c" listType="bulleted">C</paragraph>');
            editor.execute("numberedList");

            expect(listTypes(editor)).toEqual([ "numbered", "bulleted", "bulleted" ]);
        });

        it("applies additionalAttributes from the command", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("numberedList", { additionalAttributes: { listStart: 5 } });

            expect(getBlock(editor, 1).getAttribute("listType")).toBe("numbered");
            expect(getBlock(editor, 1).getAttribute("listStart")).toBe(5);
            expect(getBlock(editor, 0).getAttribute("listType")).toBe("bulleted");
        });

        it("retargets when forceValue turns the command on", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("numberedList", { forceValue: true });

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "bulleted" ]);
        });

        it("unlists the current item when forceValue turns the command off", () => {
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("numberedList", { forceValue: false });

            expect(getBlock(editor, 1).hasAttribute("listItemId")).toBe(false);
            expect(listTypes(editor)[0]).toBe("bulleted");
            expect(listTypes(editor)[2]).toBe("bulleted");
        });
    });

    describe("outdentList", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createEditor();
        });

        it("keeps the type of a nested item that already has content", () => {
            setModelData(editor.model,
                "<paragraph>intro</paragraph>" +
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]B</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ undefined, "bulleted", "numbered" ]);
            expect(getBlock(editor, 2).getAttribute("listIndent")).toBe(0);
        });

        it("keeps a to-do item's type when it already has content", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="todo">[]Task</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "todo" ]);
        });

        it("lets an empty nested item take the type of the list it joins", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(0);
        });

        it("lets an empty nested item adapt when the whole list is empty", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted"></paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted" ]);
        });

        it("keeps type on every block of a contentful multi-block item", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">Second</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "numbered" ]);
            expect(getBlock(editor, 1).getAttribute("listItemId"))
                .toBe(getBlock(editor, 2).getAttribute("listItemId"));
        });

        it("keeps a nested child's type when its parent is outdented", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]B</paragraph>' +
                '<paragraph listIndent="2" listItemId="c" listType="todo">C</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "todo" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(0);
            expect(getBlock(editor, 2).getAttribute("listIndent")).toBe(1);
        });

        it("still turns an indent-0 item into a paragraph", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="numbered">[]B</paragraph>');
            editor.execute("outdentList");

            expect(getBlock(editor, 0).hasAttribute("listItemId")).toBe(false);
            expect(getBlock(editor, 0).getChild(0)?.data).toBe("B");
        });

        it("leaves type unchanged when the sibling it joins is already the same type", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="numbered">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]B</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "numbered", "numbered" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(0);
        });

        it("undoes the outdent and the kept type in one step", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]B</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(0);

            editor.execute("undo");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(1);
        });
    });

    describe("indentList", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createEditor();
        });

        it("stays enabled next to a different-type sibling after outdent", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]B</paragraph>');
            editor.execute("outdentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered" ]);
            expect(editor.commands.get("indentList")?.isEnabled).toBe(true);

            editor.execute("indentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(1);
        });

        it("indents a numbered item that sits next to a bullet", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="numbered">[]B</paragraph>');

            expect(editor.commands.get("indentList")?.isEnabled).toBe(true);
            editor.execute("indentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered" ]);
            expect(getBlock(editor, 1).getAttribute("listIndent")).toBe(1);
        });

        it("keeps type when indenting next to a nested item of a different type", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="c" listType="bulleted">C</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="numbered">[]B</paragraph>');

            expect(editor.commands.get("indentList")?.isEnabled).toBe(true);
            editor.execute("indentList");

            expect(listTypes(editor)).toEqual([ "bulleted", "bulleted", "numbered" ]);
            expect(getBlock(editor, 2).getAttribute("listIndent")).toBe(1);
        });

        it("still cannot indent the first item in a list", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="numbered">[]A</paragraph>' +
                '<paragraph listIndent="0" listItemId="b" listType="bulleted">B</paragraph>');

            expect(editor.commands.get("indentList")?.isEnabled).toBe(false);
        });

        it("does not enable indent outside a list", () => {
            setModelData(editor.model, "<paragraph>[]plain</paragraph>");
            expect(editor.commands.get("indentList")?.isEnabled).toBe(false);
        });

        it("does not enable indent when the previous list item is a parent, not a sibling", () => {
            setModelData(editor.model,
                '<paragraph listIndent="0" listItemId="a" listType="bulleted">A</paragraph>' +
                '<paragraph listIndent="1" listItemId="b" listType="numbered">[]B</paragraph>');

            expect(editor.commands.get("indentList")?.isEnabled).toBe(false);
        });
    });

    describe("without TodoList", () => {
        it("still retargets a numbered command when todoList is not registered", async () => {
            const editor = await createTestEditor(
                [ Essentials, Paragraph, List, Autoformat, ListTypeAutoformat ]
            );
            setModelData(editor.model, THREE_BULLETS);
            editor.execute("numberedList");

            expect(listTypes(editor)).toEqual([ "bulleted", "numbered", "bulleted" ]);
        });
    });
});
