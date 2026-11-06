import type BNote from "../becca/entities/bnote.js";

import becca from "../becca/becca.js";
import attributeService from "./attributes.js";
import cloningService from "./cloning.js";
import { dayjs, Dayjs, getFirstDayOfWeek1, getWeekInfo, WeekSettings } from "@triliumnext/commons";
import hoistedNoteService from "./hoisted_note.js";
import noteService from "./notes.js";
import optionService from "./options.js";
import protectedSessionService from "./protected_session.js";
import searchContext from "../services/search/search_context.js";
import searchService from "../services/search/services/search.js";
import { getSql } from "./sql/index.js";
import { t } from "i18next";
import { ordinal } from "./i18n.js";

const CALENDAR_ROOT_LABEL = "calendarRoot";
const WORKSPACE_CALENDAR_ROOT_LABEL = "workspaceCalendarRoot";
const YEAR_LABEL = "yearNote";
const QUARTER_LABEL = "quarterNote";
const MONTH_LABEL = "monthNote";
const WEEK_LABEL = "weekNote";
const DATE_LABEL = "dateNote";

const WEEKDAY_TRANSLATION_IDS = [
    "weekdays.sunday", "weekdays.monday", "weekdays.tuesday",
    "weekdays.wednesday", "weekdays.thursday", "weekdays.friday",
    "weekdays.saturday", "weekdays.sunday"
];

const MONTH_TRANSLATION_IDS = [
    "months.january",
    "months.february",
    "months.march",
    "months.april",
    "months.may",
    "months.june",
    "months.july",
    "months.august",
    "months.september",
    "months.october",
    "months.november",
    "months.december"
];

type TimeUnit = "year" | "quarter" | "month" | "week" | "day";

const baseReplacements = {
    year: [ "year" ],
    quarter: [ "quarterNumber", "shortQuarter" ],
    month: [ "isoMonth", "monthNumber", "monthNumberPadded",
        "month", "shortMonth3", "shortMonth4" ],
    week: [ "weekNumber", "weekNumberPadded", "shortWeek", "shortWeek3" ],
    day: [ "isoDate", "dateNumber", "dateNumberPadded",
        "ordinal", "weekDay", "weekDay3", "weekDay2" ]
};

function getTimeUnitReplacements(timeUnit: TimeUnit): string[] {
    const units: TimeUnit[] = [ "year", "quarter", "month", "week", "day" ];
    const index = units.indexOf(timeUnit);
    return units.slice(0, index + 1).flatMap(unit => baseReplacements[unit]);
}

function getJournalNoteTitle(
    rootNote: BNote,
    timeUnit: TimeUnit,
    dateObj: Dayjs,
    number: number,
    weekYear?: number  // Optional: the week year for cross-year weeks
) {
    const patterns = {
        year: rootNote.getOwnedLabelValue("yearPattern") || "{year}",
        quarter: rootNote.getOwnedLabelValue("quarterPattern") || t("quarterNumber"),
        month: rootNote.getOwnedLabelValue("monthPattern") || "{monthNumberPadded} - {month}",
        week: rootNote.getOwnedLabelValue("weekPattern") || t("weekdayNumber"),
        day: rootNote.getOwnedLabelValue("datePattern") || "{dateNumberPadded} - {weekDay}"
    };

    const pattern = patterns[timeUnit];
    const monthName = t(MONTH_TRANSLATION_IDS[dateObj.month()]);
    const weekDay = t(WEEKDAY_TRANSLATION_IDS[dateObj.day()]);
    const ordinalStr = ordinal(dateObj);

    // Each placeholder must be filled from its own time unit, not from the unit of the note
    // being created (e.g. {monthNumber} in a datePattern is the month, not the day — #9565).
    // The caller-provided number stays authoritative for the note's own unit, because week
    // numbers depend on user settings and cross-year handling already resolved by the caller.
    const quarterNumberStr = (timeUnit === "quarter" ? number : dateObj.quarter()).toString();
    const monthNumberStr = (timeUnit === "month" ? number : dateObj.month() + 1).toString();
    const weekNumberStr = (timeUnit === "week"
        ? number
        : getWeekInfo(dateObj, getWeekSettings()).weekNumber
    ).toString();
    const dateNumberStr = (timeUnit === "day" ? number : dateObj.date()).toString();

    // For week notes, use the weekYear if provided (handles cross-year weeks)
    const yearForDisplay = (timeUnit === "week" && weekYear !== undefined)
        ? weekYear.toString()
        : dateObj.format("YYYY");

    const allReplacements: Record<string, string> = {
        // Common date formats
        "{year}": yearForDisplay,

        // Month related
        "{isoMonth}": dateObj.format("YYYY-MM"),
        "{monthNumber}": monthNumberStr,
        "{monthNumberPadded}": monthNumberStr.padStart(2, "0"),
        "{month}": monthName,
        "{shortMonth3}": monthName.slice(0, 3),
        "{shortMonth4}": monthName.slice(0, 4),

        // Quarter related
        "{quarterNumber}": quarterNumberStr,
        "{shortQuarter}": `Q${quarterNumberStr}`,

        // Week related
        "{weekNumber}": weekNumberStr,
        "{weekNumberPadded}": weekNumberStr.padStart(2, "0"),
        "{shortWeek}": `W${weekNumberStr}`,
        "{shortWeek3}": `W${weekNumberStr.padStart(2, "0")}`,

        // Day related
        "{isoDate}": dateObj.format("YYYY-MM-DD"),
        "{dateNumber}": dateNumberStr,
        "{dateNumberPadded}": dateNumberStr.padStart(2, "0"),
        "{ordinal}": ordinalStr,
        "{weekDay}": weekDay,
        "{weekDay3}": weekDay.substring(0, 3),
        "{weekDay2}": weekDay.substring(0, 2)
    };

    const allowedReplacements = Object.entries(allReplacements).reduce((acc, [ key, value ]) => {
        const replacementKey = key.slice(1, -1);
        if (getTimeUnitReplacements(timeUnit).includes(replacementKey)) {
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, string>);

    return Object.entries(allowedReplacements).reduce(
        (title, [ key, value ]) => title.replace(new RegExp(key, "g"), value),
        pattern
    );
}

function createNote(parentNote: BNote, noteTitle: string) {
    return noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title: noteTitle,
        content: "",
        isProtected: parentNote.isProtected &&
         protectedSessionService.isProtectedSessionAvailable(),
        type: "text"
    }).note;
}

/**
 * The workspace calendar, when the current hoist is a workspace that has one.
 * At the root there is no workspace calendar to use: searching there would see
 * every `#workspaceCalendarRoot`.
 */
function findHoistedWorkspaceCalendar(): BNote | null {
    const workspaceNote = hoistedNoteService.getWorkspaceNote();

    if (workspaceNote?.isRoot()) {
        return null;
    }

    return searchService.findFirstNoteWithQuery(
        `#${WORKSPACE_CALENDAR_ROOT_LABEL}`,
        new searchContext({ ignoreHoistedNote: false })
    );
}

/** The calendar new day notes go to, or null when the journal has been removed. */
function getExistingCalendarRoot(): BNote | null {
    return findHoistedWorkspaceCalendar() ?? attributeService.getNoteWithLabel(CALENDAR_ROOT_LABEL);
}

function isOwnedCalendarRoot(note: BNote): boolean {
    return note.hasOwnedLabel(CALENDAR_ROOT_LABEL)
        || note.hasOwnedLabel(WORKSPACE_CALENDAR_ROOT_LABEL);
}

/**
 * Whether `note` is this calendar's own year, month or day note.
 *
 * A workspace calendar placed inside the journal carries the same labels on
 * its own copies. Those copies stay with the workspace: a path that reaches
 * them passes through their `#workspaceCalendarRoot` first.
 */
function belongsToCalendar(note: BNote, rootNote: BNote): boolean {
    const seen = new Set<string>();

    function reaches(current: BNote): boolean {
        if (current.noteId === rootNote.noteId) {
            return true;
        }

        if (seen.has(current.noteId) || isOwnedCalendarRoot(current)) {
            return false;
        }

        seen.add(current.noteId);

        for (const parent of current.getParentNotes()) {
            if (reaches(parent)) {
                return true;
            }
        }

        return false;
    }

    return reaches(note);
}

function findJournalNote(rootNote: BNote, labelName: string, value: string): BNote | null {
    const matches = searchService.searchNotes(`#${labelName}="${value}"`, {
        ancestorNoteId: rootNote.noteId
    });

    for (const note of matches) {
        if (note && belongsToCalendar(note, rootNote)) {
            return note;
        }
    }

    return null;
}

const DAY_NOTES_FOR_MONTH_SQL = `\
        SELECT
            attr.value AS date,
            notes.noteId
        FROM notes
        JOIN attributes attr USING(noteId)
        WHERE notes.isDeleted = 0
            AND attr.isDeleted = 0
            AND attr.type = 'label'
            AND attr.name = 'dateNote'
            AND attr.value LIKE ? || '%'`;

/**
 * Day notes of `month` (`YYYY-MM`) that belong to `calendarRoot`.
 *
 * A calendar root contributes its own day notes. An ancestor that is not a
 * calendar, such as the document root, contributes every day note under it.
 */
function getDayNoteMapForMonth(month: string, calendarRoot: BNote | null): Record<string, string> {
    if (!calendarRoot) {
        return {};
    }

    const rows = getSql().getRows<{ date: string; noteId: string }>(
        DAY_NOTES_FOR_MONTH_SQL, [month]
    );
    const strict = isOwnedCalendarRoot(calendarRoot);
    const result: Record<string, string> = {};

    for (const { date, noteId } of rows) {
        const note = becca.getNote(noteId);
        if (!note) {
            continue;
        }

        const included = strict
            ? belongsToCalendar(note, calendarRoot)
            : note.hasAncestor(calendarRoot.noteId);
        if (included) {
            result[date] = noteId;
        }
    }

    return result;
}

function getRootCalendarNote(): BNote {
    let rootNote = getExistingCalendarRoot();

    if (!rootNote) {
        getSql().transactional(() => {
            rootNote = noteService.createNewNote({
                parentNoteId: "root",
                title: "Calendar",
                target: "into",
                isProtected: false,
                type: "text",
                content: ""
            }).note;

            attributeService.createLabel(rootNote.noteId, CALENDAR_ROOT_LABEL);
            attributeService.createLabel(rootNote.noteId, "sorted");
        });
    }

    return rootNote as BNote;
}

function getYearNote(dateStr: string, _rootNote: BNote | null = null): BNote {
    const rootNote = _rootNote || getRootCalendarNote();

    const yearStr = dateStr.trim().substring(0, 4);

    let yearNote = findJournalNote(rootNote, YEAR_LABEL, yearStr);

    if (yearNote) {
        return yearNote;
    }

    getSql().transactional(() => {
        yearNote = createNote(rootNote, yearStr);

        attributeService.createLabel(yearNote.noteId, YEAR_LABEL, yearStr);
        attributeService.createLabel(yearNote.noteId, "sorted");

        const yearTemplateAttr = rootNote.getOwnedAttribute("relation", "yearTemplate");

        if (yearTemplateAttr) {
            attributeService.createRelation(yearNote.noteId, "template", yearTemplateAttr.value);
        }
    });

    return yearNote as unknown as BNote;
}

function getQuarterNumberStr(date: Dayjs) {
    return `${date.year()}-Q${date.quarter()}`;
}

function getQuarterNote(quarterStr: string, _rootNote: BNote | null = null): BNote {
    const rootNote = _rootNote || getRootCalendarNote();

    quarterStr = quarterStr.trim().substring(0, 7);

    let quarterNote = findJournalNote(rootNote, QUARTER_LABEL, quarterStr);

    if (quarterNote) {
        return quarterNote;
    }

    const [ yearStr, quarterNumberStr ] = quarterStr.trim().split("-Q");
    const quarterNumber = parseInt(quarterNumberStr);
    const firstMonth = (quarterNumber - 1) * 3;
    const quarterStartDate = dayjs().year(parseInt(yearStr)).month(firstMonth).date(1);

    const yearNote = getYearNote(yearStr, rootNote);
    const noteTitle = getJournalNoteTitle(
        rootNote, "quarter", quarterStartDate, quarterNumber
    );

    getSql().transactional(() => {
        quarterNote = createNote(yearNote, noteTitle);

        attributeService.createLabel(quarterNote.noteId, QUARTER_LABEL, quarterStr);
        attributeService.createLabel(quarterNote.noteId, "sorted");

        const quarterTemplateAttr = rootNote.getOwnedAttribute("relation", "quarterTemplate");

        if (quarterTemplateAttr) {
            attributeService.createRelation(
                quarterNote.noteId, "template", quarterTemplateAttr.value
            );
        }
    });

    return quarterNote as unknown as BNote;
}

function getMonthNote(dateStr: string, _rootNote: BNote | null = null): BNote {
    const rootNote = _rootNote || getRootCalendarNote();

    const monthStr = dateStr.substring(0, 7);
    const monthNumber = dateStr.substring(5, 7);

    let monthNote = findJournalNote(rootNote, MONTH_LABEL, monthStr);

    if (monthNote) {
        return monthNote;
    }

    let monthParentNote: BNote | null;

    if (rootNote.hasLabel("enableQuarterNote")) {
        monthParentNote = getQuarterNote(getQuarterNumberStr(dayjs(dateStr)), rootNote);
    } else {
        monthParentNote = getYearNote(dateStr, rootNote);
    }

    const noteTitle = getJournalNoteTitle(
        rootNote, "month", dayjs(dateStr), parseInt(monthNumber)
    );

    getSql().transactional(() => {
        monthNote = createNote(monthParentNote, noteTitle);

        attributeService.createLabel(monthNote.noteId, MONTH_LABEL, monthStr);
        attributeService.createLabel(monthNote.noteId, "sorted");

        const monthTemplateAttr = rootNote.getOwnedAttribute("relation", "monthTemplate");

        if (monthTemplateAttr) {
            attributeService.createRelation(monthNote.noteId, "template", monthTemplateAttr.value);
        }
    });

    return monthNote as unknown as BNote;
}

function getWeekSettings(): WeekSettings {
    return {
        firstDayOfWeek: parseInt(optionService.getOptionOrNull("firstDayOfWeek") ?? "1", 10),
        firstWeekOfYear: parseInt(optionService.getOptionOrNull("firstWeekOfYear") ?? "0", 10),
        minDaysInFirstWeek: parseInt(optionService.getOptionOrNull("minDaysInFirstWeek") ?? "4", 10)
    };
}

function getWeekStartDate(date: Dayjs): Dayjs {
    const firstDayISO = parseInt(optionService.getOptionOrNull("firstDayOfWeek") ?? "1", 10);
    const day = date.isoWeekday();
    const diff = (day - firstDayISO + 7) % 7;
    return date.clone().subtract(diff, "day").startOf("day");
}

function getWeekNumberStr(date: Dayjs): string {
    const { weekYear, weekNumber } = getWeekInfo(date, getWeekSettings());
    return `${weekYear}-W${weekNumber.toString().padStart(2, "0")}`;
}

function getWeekFirstDayNote(dateStr: string, rootNote: BNote | null = null) {
    const weekStartDate = getWeekStartDate(dayjs(dateStr));
    return getDayNote(weekStartDate.format("YYYY-MM-DD"), rootNote);
}

/**
 * Returns the {@link BNote} corresponding to the given week. If there is no note associated yet to that week, it will be created and returned instead.
 *
 * @param weekStr the week for which to return the corresponding note, in the format `2024-W04`.
 * @param _rootNote a {@link BNote} representing the calendar root, or {@code null} or not specified to use the default root calendar note.
 * @returns a Promise that resolves to the {@link BNote} corresponding to the week note.
 */
function getWeekNote(weekStr: string, _rootNote: BNote | null = null): BNote | null {
    const rootNote = _rootNote || getRootCalendarNote();
    if (!rootNote.hasLabel("enableWeekNote")) {
        return null;
    }

    weekStr = weekStr.trim().substring(0, 8);

    let weekNote = findJournalNote(rootNote, WEEK_LABEL, weekStr);

    if (weekNote) {
        return weekNote;
    }

    const [ yearStr, weekNumStr ] = weekStr.trim().split("-W");
    const weekNumber = parseInt(weekNumStr);
    const weekYear = parseInt(yearStr);

    // Calculate week start date based on user's first week of year settings.
    // This correctly handles cross-year weeks based on user preferences.
    const firstDayOfWeek1 = getFirstDayOfWeek1(weekYear, getWeekSettings());
    const startDate = firstDayOfWeek1.add(weekNumber - 1, "week");
    const endDate = startDate.add(6, "day");

    const startMonth = startDate.month();
    const endMonth = endDate.month();

    const monthNote = getMonthNote(startDate.format("YYYY-MM-DD"), rootNote);
    const noteTitle = getJournalNoteTitle(rootNote, "week", startDate, weekNumber, weekYear);

    getSql().transactional(() => {
        weekNote = createNote(monthNote, noteTitle);

        attributeService.createLabel(weekNote.noteId, WEEK_LABEL, weekStr);
        attributeService.createLabel(weekNote.noteId, "sorted");

        const weekTemplateAttr = rootNote.getOwnedAttribute("relation", "weekTemplate");

        if (weekTemplateAttr) {
            attributeService.createRelation(weekNote.noteId, "template", weekTemplateAttr.value);
        }

        // If the week spans different months, clone the week note in the other month as well
        if (startMonth !== endMonth) {
            const secondMonthNote = getMonthNote(endDate.format("YYYY-MM-DD"), rootNote);
            cloningService.cloneNoteToParentNote(weekNote.noteId, secondMonthNote.noteId);
        }
    });

    return weekNote as unknown as BNote;
}

function getDayNote(dateStr: string, _rootNote: BNote | null = null): BNote {
    const rootNote = _rootNote || getRootCalendarNote();

    dateStr = dateStr.trim().substring(0, 10);

    let dateNote = findJournalNote(rootNote, DATE_LABEL, dateStr);

    if (dateNote) {
        return dateNote;
    }

    let dateParentNote: BNote | null;

    if (rootNote.hasLabel("enableWeekNote")) {
        dateParentNote = getWeekNote(getWeekNumberStr(dayjs(dateStr)), rootNote);
    } else {
        dateParentNote = getMonthNote(dateStr, rootNote);
    }

    const dayNumber = dateStr.substring(8, 10);
    const noteTitle = getJournalNoteTitle(
        rootNote, "day", dayjs(dateStr), parseInt(dayNumber)
    );

    getSql().transactional(() => {
        dateNote = createNote(dateParentNote as BNote, noteTitle);

        attributeService.createLabel(dateNote.noteId, DATE_LABEL, dateStr.substring(0, 10));

        const dateTemplateAttr = rootNote.getOwnedAttribute("relation", "dateTemplate");

        if (dateTemplateAttr) {
            attributeService.createRelation(dateNote.noteId, "template", dateTemplateAttr.value);
        }
    });

    return dateNote as unknown as BNote;
}

function getTodayNote(rootNote: BNote | null = null) {
    return getDayNote(dayjs().format("YYYY-MM-DD"), rootNote);
}

/**
 * Whether a journal exists. `getRootCalendarNote()` builds one when it finds none, which is
 * what asking for a day note means; callers that are only capturing a note check this first so
 * that a deleted journal stays deleted.
 */
function hasCalendarRoot() {
    return !!attributeService.getNoteWithLabel(CALENDAR_ROOT_LABEL);
}

export default {
    getRootCalendarNote,
    getExistingCalendarRoot,
    getDayNoteMapForMonth,
    hasCalendarRoot,
    getYearNote,
    getQuarterNote,
    getMonthNote,
    getWeekNote,
    getWeekFirstDayNote,
    getDayNote,
    getTodayNote,
    getJournalNoteTitle
};
