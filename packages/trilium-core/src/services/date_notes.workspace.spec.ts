import { describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import { getContext } from "./context.js";
import dateNotes from "./date_notes.js";
import noteService from "./notes.js";

/**
 * A global `#calendarRoot` and a `#workspaceCalendarRoot`. `nested` places the
 * workspace inside the global journal, so a search of that journal also sees
 * the workspace's year, month and day notes.
 *
 * Other `#calendarRoot` labels are dropped from the index: the lookup uses the
 * first one it finds, and an earlier test's journal would otherwise win.
 */
function buildCalendars(nested: boolean) {
    return getContext().init(() => {
        const calendar = noteService.createNewNote({
            parentNoteId: "root",
            title: nested ? "Journal-nested" : "Journal-sibling",
            content: "",
            type: "text"
        }).note;
        calendar.setLabel("calendarRoot");

        const roots = becca.findAttributes("label", "calendarRoot");
        for (const attr of roots) {
            if (attr.noteId !== calendar.noteId) {
                becca.attributeIndex["label-calendarroot"]?.delete(attr);
            }
        }

        const workspace = noteService.createNewNote({
            parentNoteId: nested ? calendar.noteId : "root",
            title: nested ? "Work-nested" : "Work-sibling",
            content: "",
            type: "text"
        }).note;
        workspace.setLabel("workspace");

        const workspaceCalendar = noteService.createNewNote({
            parentNoteId: workspace.noteId,
            title: nested ? "Work journal-nested" : "Work journal-sibling",
            content: "",
            type: "text"
        }).note;
        workspaceCalendar.setLabel("workspaceCalendarRoot");

        return { calendar, workspace, workspaceCalendar };
    });
}

function dayNote(date: string, hoistedNoteId: string) {
    return getContext().init(() => {
        getContext().set("hoistedNoteId", hoistedNoteId);
        return dateNotes.getDayNote(date);
    });
}

function expectGlobalDay(date: string, calendarId: string, workspaceCalendarId: string) {
    const note = dayNote(date, "root");
    expect(note.hasAncestor(calendarId)).toBe(true);
    expect(note.hasAncestor(workspaceCalendarId)).toBe(false);
    return note;
}

describe("date notes follow the hoisted calendar", () => {
    it("keeps unhoisted day notes in the global calendar", () => {
        const { calendar, workspace, workspaceCalendar } = buildCalendars(false);

        const seeded = dayNote("2026-04-02", workspace.noteId);
        expect(seeded.hasAncestor(workspaceCalendar.noteId)).toBe(true);

        getContext().init(() => {
            getContext().set("hoistedNoteId", "root");
            const unhoisted = dateNotes.getDayNoteMapForMonth(
                "2026-04", dateNotes.getExistingCalendarRoot()
            );
            expect(unhoisted["2026-04-02"]).toBeUndefined();

            getContext().set("hoistedNoteId", workspace.noteId);
            const hoisted = dateNotes.getDayNoteMapForMonth(
                "2026-04", dateNotes.getExistingCalendarRoot()
            );
            expect(hoisted["2026-04-02"]).toBe(seeded.noteId);
        });

        expectGlobalDay("2026-04-02", calendar.noteId, workspaceCalendar.noteId);
        expectGlobalDay("2026-04-03", calendar.noteId, workspaceCalendar.noteId);

        const hoisted = dayNote("2026-04-04", workspace.noteId);
        expect(hoisted.hasAncestor(workspaceCalendar.noteId)).toBe(true);
        expect(hoisted.hasAncestor(calendar.noteId)).toBe(false);
    });

    it("does not reuse a workspace journal that sits inside the global calendar", () => {
        const { calendar, workspace, workspaceCalendar } = buildCalendars(true);

        const seeded = dayNote("2026-05-02", workspace.noteId);
        expect(seeded.hasAncestor(workspaceCalendar.noteId)).toBe(true);

        getContext().init(() => {
            getContext().set("hoistedNoteId", "root");
            const before = dateNotes.getDayNoteMapForMonth("2026-05", calendar);
            expect(before["2026-05-02"]).toBeUndefined();
        });

        expectGlobalDay("2026-05-02", calendar.noteId, workspaceCalendar.noteId);
        expectGlobalDay("2026-05-03", calendar.noteId, workspaceCalendar.noteId);

        const hoisted = dayNote("2026-05-04", workspace.noteId);
        expect(hoisted.hasAncestor(workspaceCalendar.noteId)).toBe(true);
    });
});
