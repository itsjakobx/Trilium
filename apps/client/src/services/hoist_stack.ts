/**
 * The hoist trail is the ordered list of nested hoists for one tab, from the global root to the
 * active hoist. `hoistedNoteId` stays the last entry so the rest of the app keeps a single sandbox.
 * Hoisting a note inside the active hoist pushes; hoisting an entry already on the trail pops back
 * to it. A hoist outside the trail replaces it, leaving only root and that note.
 */

export interface HoistState {
    hoistedNoteId?: string;
    hoistStack: string[];
}

export function stacksEqual(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((noteId, index) => noteId === right[index]);
}

/** A trail that starts at root and ends at `hoistedNoteId`, dropping holes and duplicates. */
export function normalizeHoistStack(stack: readonly string[] | undefined, hoistedNoteId: string | undefined): string[] {
    const activeId = hoistedNoteId || "root";
    const unique: string[] = [];
    for (const noteId of stack ?? []) {
        if (noteId && !unique.includes(noteId)) {
            unique.push(noteId);
        }
    }
    if (unique[0] !== "root") {
        unique.unshift("root");
    }

    if (activeId === "root") {
        return ["root"];
    }

    const activeIndex = unique.indexOf(activeId);
    if (activeIndex >= 0) {
        return unique.slice(0, activeIndex + 1);
    }
    return ["root", activeId];
}

/**
 * The trail after hoisting `noteIdToHoist`. `insideActiveHoist` is true when that note lives in the
 * subtree of the trail's last entry, so the hoist is nested instead of a fresh sandbox.
 */
export function nextHoistStack(current: readonly string[], noteIdToHoist: string, insideActiveHoist: boolean): string[] {
    const activeId = current.at(-1) ?? "root";
    const stack = normalizeHoistStack(current, activeId);
    if (!noteIdToHoist || noteIdToHoist === "root") {
        return ["root"];
    }

    const existing = stack.indexOf(noteIdToHoist);
    if (existing >= 0) {
        return stack.slice(0, existing + 1);
    }

    const active = stack[stack.length - 1];
    if (insideActiveHoist && active !== "root" && active !== noteIdToHoist) {
        return [...stack, noteIdToHoist];
    }
    return ["root", noteIdToHoist];
}

/** Trail entries still present, up to the first note that was deleted or fell out of its parent hoist. */
export function keptHoistPrefix(stack: readonly string[], isStillInside: (noteId: string, parentId: string) => boolean): string[] {
    const normalized = normalizeHoistStack(stack, stack.at(-1) ?? "root");
    const kept = ["root"];
    for (let index = 1; index < normalized.length; index++) {
        const noteId = normalized[index];
        if (!isStillInside(noteId, kept[kept.length - 1])) {
            break;
        }
        kept.push(noteId);
    }
    return kept;
}

export function readHoistState(noteContext: { hoistedNoteId?: string; hoistStack?: string[] } | null | undefined): HoistState {
    const hoistedNoteId = noteContext?.hoistedNoteId;
    return {
        hoistedNoteId,
        hoistStack: noteContext?.hoistStack?.length
            ? noteContext.hoistStack
            : normalizeHoistStack(undefined, hoistedNoteId)
    };
}
