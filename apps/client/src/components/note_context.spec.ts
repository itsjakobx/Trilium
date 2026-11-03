import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import froca from "../services/froca.js";
import type { ViewScope } from "../services/link.js";
import utils from "../services/utils.js";
import { buildNote } from "../test/easy-froca.js";
import appContext from "./app_context.js";
import NoteContext from "./note_context.js";
import type TabManager from "./tab_manager.js";

describe("NoteContext.isCommandTarget", () => {
    it("matches a command with its own ntxId, or one without an ntxId while it is the active context", () => {
        const tabManager = appContext.tabManager;
        appContext.tabManager = { activeNtxId: "tab" } as TabManager;
        try {
            const tab = new NoteContext("tab");
            const popup = new NoteContext("_popup-editor");

            expect(popup.isCommandTarget("_popup-editor")).toBe(true);
            expect(tab.isCommandTarget("_popup-editor")).toBe(false);
            expect(tab.isCommandTarget(undefined)).toBe(true);
            expect(popup.isCommandTarget(undefined)).toBe(false);
        } finally {
            appContext.tabManager = tabManager;
        }
    });
});

describe("NoteContext read-only capability", () => {
    let noteContext: NoteContext;

    beforeEach(() => {
        noteContext = new NoteContext();
    });

    it("reports a collection read-only only where its view honours the label", async () => {
        // A list or a grid wearing #readOnly is still editable, so reporting it would put a
        // read-only badge over a collection that can be changed.
        const viewTypes = [
            [ "board", true ], [ "calendar", true ], [ "dashboard", true ], [ "geoMap", true ],
            [ "presentation", true ], [ "table", true ], [ "list", false ], [ "grid", false ]
        ] as const;
        for (const [ viewType, expected ] of viewTypes) {
            const note = buildNote({
                "title": viewType, "type": "book", "#viewType": viewType, "#readOnly": ""
            });
            noteContext.noteId = note.noteId;

            expect(await noteContext.isReadOnly(), viewType).toBe(expected);
        }
    });

    it("reports the note maps and render notes read-only under the label", async () => {
        for (const type of [ "noteMap", "relationMap", "render" ] as const) {
            const note = buildNote({ "title": type, "type": type, "#readOnly": "" });
            noteContext.noteId = note.noteId;

            expect(await noteContext.isReadOnly(), type).toBe(true);
        }
    });

    it("leaves a geo map editable unless locked, or while temporarily unlocked", async () => {
        const unlocked = buildNote({
            "title": "Unlocked map", "type": "book", "#viewType": "geoMap"
        });
        noteContext.noteId = unlocked.noteId;
        expect(await noteContext.isReadOnly()).toBe(false);

        const locked = buildNote({
            "title": "Locked map", "type": "book", "#viewType": "geoMap", "#readOnly": ""
        });
        noteContext.noteId = locked.noteId;
        expect(await noteContext.isReadOnly()).toBe(true);

        // What the read-only badge does when it is clicked: the label stays, the tab stops
        // honouring it.
        if (noteContext.viewScope) noteContext.viewScope.readOnlyTemporarilyDisabled = true;
        expect(await noteContext.isReadOnly()).toBe(false);
    });

    it("keeps a note whose content cannot be saved read-only, even once editing is enabled", async () => {
        const note = buildNote({ title: "Help page", type: "text" });
        note.isContentWritable = false;
        noteContext.noteId = note.noteId;
        expect(await noteContext.isReadOnly()).toBe(true);

        noteContext.resetViewScope();
        const viewScope = noteContext.viewScope;
        expect(viewScope).toBeTruthy();
        if (viewScope) viewScope.readOnlyTemporarilyDisabled = true;
        expect(await noteContext.isReadOnly()).toBe(true);
    });
});

describe("NoteContext view scope", () => {
    it("keeps its own copy of the view scope it is given", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "blocks", title: "Blocks" } ] });
        const viewScope: ViewScope = { block: "a" };
        const noteContext = new NoteContext();

        await noteContext.setNote("root/blocks", {
            viewScope, skipRecentNotes: true, triggerSwitchEvent: false
        });
        expect(noteContext.viewScope).toEqual({ block: "a", viewMode: "default" });

        // What `revealBlockReference()` does once it has scrolled to the block.
        if (noteContext.viewScope) noteContext.viewScope.block = undefined;
        expect(viewScope).toEqual({ block: "a" });
    });

    it("stays on the open note when it is navigated to again", async () => {
        buildNote({
            id: "root", title: "root", children: [ { id: "reopened", title: "Reopened" } ]
        });
        const noteContext = new NoteContext();
        const navigate = (viewScope?: ViewScope) => noteContext.setNote("root/reopened", {
            viewScope, skipRecentNotes: true, triggerSwitchEvent: false
        });

        await navigate();
        expect(await noteContext.isReadOnly()).toBe(false);
        const shownScope = noteContext.viewScope;
        expect(shownScope).toEqual({ viewMode: "default", isReadOnly: false });
        // What the "Edit" button of a read-only note and `consumeBookmark()` write into the scope.
        if (shownScope) {
            shownScope.readOnlyTemporarilyDisabled = true;
            shownScope.bookmark = undefined;
        }

        await navigate();
        expect(noteContext.viewScope).toBe(shownScope);

        await navigate({ bookmark: "intro" });
        expect(noteContext.viewScope).toEqual({ viewMode: "default", bookmark: "intro" });
    });
});

describe("NoteContext on a phone", () => {
    // `tree.resolveNotePath()` reads the active note path from the tab manager.
    const { tabManager } = appContext;
    beforeEach(() => {
        appContext.tabManager = { getActiveContextNotePath: () => null } as unknown as TabManager;
    });
    afterEach(() => {
        appContext.tabManager = tabManager;
        vi.restoreAllMocks();
    });

    it("shows a note it opens, but stays on the tree when hoisting opens one", async () => {
        buildNote({ id: "root", title: "root", children: [
            { id: "elsewhere", title: "Elsewhere" },
            { id: "workspace", title: "Workspace", "#workspace": "", children: [ { id: "inside", title: "Inside" } ] }
        ] });
        vi.spyOn(utils, "isMobile").mockReturnValue(true);
        const noteContext = new NoteContext();
        const triggerCommand = vi.spyOn(noteContext, "triggerCommand");
        const screenSwitches = () => triggerCommand.mock.calls.filter(([ name ]) => name === "setActiveScreen");

        await noteContext.setNote("root/elsewhere", { skipRecentNotes: true, triggerSwitchEvent: false });
        expect(screenSwitches()).toEqual([ [ "setActiveScreen", { screen: "detail" } ] ]);

        triggerCommand.mockClear();
        // The open note lies outside the workspace, so hoisting opens the workspace note.
        await noteContext.setHoistedNoteId("workspace");
        expect(noteContext.notePath).toBe("root/workspace");
        expect(screenSwitches()).toEqual([]);
    });
});

describe("NoteContext hoist stack", () => {
    const { tabManager } = appContext;
    beforeEach(() => {
        appContext.tabManager = {
            getActiveContextNotePath: () => null,
            noteContexts: []
        } as unknown as TabManager;
    });
    afterEach(() => {
        appContext.tabManager = tabManager;
    });

    function tree() {
        buildNote({
            id: "root", title: "Root", children: [
                { id: "work", title: "Work", "#workspace": "", children: [
                    { id: "proj", title: "Project", children: [
                        { id: "page", title: "Page" }
                    ] }
                ] },
                { id: "other", title: "Other" }
            ]
        });
    }

    it("pushes a nested hoist and pops one layer without dropping the ones above it", async () => {
        tree();
        const noteContext = new NoteContext();
        await noteContext.setNote("root/work/proj/page", { skipRecentNotes: true, triggerSwitchEvent: false });
        await noteContext.setHoistedNoteId("work");
        await noteContext.setHoistedNoteId("proj");

        expect(noteContext.hoistStack).toEqual([ "root", "work", "proj" ]);
        expect(noteContext.hoistedNoteId).toBe("proj");
        expect(noteContext.noteId).toBe("page");

        await noteContext.unhoist();
        expect(noteContext.hoistStack).toEqual([ "root", "work" ]);
        expect(noteContext.hoistedNoteId).toBe("work");
        expect(noteContext.noteId).toBe("page");

        await noteContext.setHoistedNoteId("work", { activateHoistedNote: true });
        expect(noteContext.noteId).toBe("work");

        await noteContext.unhoistAll();
        expect(noteContext.hoistStack).toEqual([ "root" ]);
        expect(noteContext.hoistedNoteId).toBe("root");
    });

    it("replaces the trail when the new hoist is outside it, and reveals only the hoists that contain a note", async () => {
        tree();
        const noteContext = new NoteContext();
        await noteContext.setNote("root/work/proj/page", { skipRecentNotes: true, triggerSwitchEvent: false });
        await noteContext.setHoistedNoteId("work");
        await noteContext.setHoistedNoteId("proj");

        await noteContext.revealHoistedNotePath("root/work/proj");
        expect(noteContext.hoistStack).toEqual([ "root", "work", "proj" ]);

        await noteContext.revealHoistedNotePath("root/work");
        expect(noteContext.hoistStack).toEqual([ "root", "work" ]);

        await noteContext.setHoistedNoteId("proj");
        await noteContext.revealHoistedNotePath("root/other");
        expect(noteContext.hoistStack).toEqual([ "root" ]);

        await noteContext.setHoistedNoteId("work");
        await noteContext.setHoistedNoteId("other");
        expect(noteContext.hoistStack).toEqual([ "root", "other" ]);
    });

    it("falls back to the nearest remaining hoist when a hoisted note is deleted", async () => {
        tree();
        const noteContext = new NoteContext();
        await noteContext.setNote("root/work/proj/page", { skipRecentNotes: true, triggerSwitchEvent: false });
        await noteContext.setHoistedNoteId("work");
        await noteContext.setHoistedNoteId("proj");
        delete froca.notes["proj"];

        await noteContext.entitiesReloadedEvent({
            loadResults: {
                isNoteReloaded: (id: string) => id === "proj" || id === "page",
                getEntityRow: () => ({ isDeleted: true }),
                getBranchRows: () => []
            }
        } as never);

        expect(noteContext.hoistStack).toEqual([ "root", "work" ]);
        expect(noteContext.hoistedNoteId).toBe("work");
    });
});
