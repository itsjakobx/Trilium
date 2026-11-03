import { describe, expect, it } from "vitest";

import { keptHoistPrefix, nextHoistStack, normalizeHoistStack, stacksEqual } from "./hoist_stack";

describe("hoist stack", () => {
    it("normalizes a saved trail so it starts at root and ends at the active hoist", () => {
        expect(normalizeHoistStack(undefined, "root")).toEqual(["root"]);
        expect(normalizeHoistStack(undefined, "noteA")).toEqual(["root", "noteA"]);
        expect(normalizeHoistStack(["noteA", "noteA", "noteB"], "noteB")).toEqual(["root", "noteA", "noteB"]);
        expect(normalizeHoistStack(["root", "noteA", "noteB", "noteC"], "noteB")).toEqual(["root", "noteA", "noteB"]);
        expect(normalizeHoistStack(["root", "noteA"], "root")).toEqual(["root"]);
    });

    it("pushes a nested hoist and pops back to an ancestor without dropping the ones above it", () => {
        const root = ["root"];
        const intoA = nextHoistStack(root, "A", false);
        const intoB = nextHoistStack(intoA, "B", true);
        const intoC = nextHoistStack(intoB, "C", true);
        expect(intoC).toEqual(["root", "A", "B", "C"]);

        expect(nextHoistStack(intoC, "A", false)).toEqual(["root", "A"]);
        expect(nextHoistStack(intoC, "root", false)).toEqual(["root"]);
        expect(nextHoistStack(intoC, "elsewhere", false)).toEqual(["root", "elsewhere"]);
    });

    it("keeps the trail only through the last hoist that is still inside its parent", () => {
        const stack = ["root", "workspace", "project", "leaf"];
        expect(keptHoistPrefix(stack, (noteId) => noteId !== "project")).toEqual(["root", "workspace"]);
        expect(keptHoistPrefix(stack, () => true)).toEqual(stack);
        expect(stacksEqual(["root", "workspace"], ["root", "workspace"])).toBe(true);
    });
});
