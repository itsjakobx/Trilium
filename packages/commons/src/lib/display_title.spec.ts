import { describe, expect, it } from "vitest";

import {
    formatDisplayTitle,
    formatNoteDisplayTitle,
    isRichDisplayTitle,
    plainTitleText,
    sanitizeTitleHtml,
    searchableTitleText,
    titleToEditorData
} from "./display_title.js";

describe("formatDisplayTitle", () => {
    it("renders markdown, HTML and a branch prefix", () => {
        expect(formatDisplayTitle("Rosa canina")).toBe("Rosa canina");
        expect(formatDisplayTitle("A < B & C")).toBe("A &lt; B &amp; C");
        expect(formatDisplayTitle("*Rosa canina*")).toBe("<em>Rosa canina</em>");
        expect(formatDisplayTitle("**Title**")).toBe("<strong>Title</strong>");
        expect(formatDisplayTitle("H<sub>2</sub>O")).toBe("H<sub>2</sub>O");
        expect(formatDisplayTitle("*Rosa*", "clone")).toBe("clone - <em>Rosa</em>");
        expect(formatNoteDisplayTitle({ title: "*Rosa canina*" }))
            .toBe("<em>Rosa canina</em>");
        expect(isRichDisplayTitle(formatDisplayTitle("*Rosa*"))).toBe(true);
    });

    it("keeps formatting tags, drops scripts and event handlers", () => {
        expect(sanitizeTitleHtml("<em onclick=alert(1)>x</em>")).toBe("<em>x</em>");
        expect(sanitizeTitleHtml("<u>x</u>")).toBe("<u>x</u>");
        expect(sanitizeTitleHtml('<span style="color: #c00">x</span>'))
            .toBe('<span style="color: #c00">x</span>');
        expect(sanitizeTitleHtml('<span style="color: url(javascript:alert(1))">x</span>'))
            .toBe("<span>x</span>");
        expect(formatDisplayTitle("<script>alert(1)</script>")).toBe("");
        expect(sanitizeTitleHtml("<p>Hello</p>")).toBe("Hello");
    });

    it("unwraps tables, math and footnotes to text in compact views", () => {
        expect(formatDisplayTitle("<p><em>Rosa</em></p>")).toBe("<em>Rosa</em>");
        expect(plainTitleText("<table><tr><td>H<sub>2</sub>O</td><td>ice</td></tr></table>"))
            .toBe("H2O ice");
        expect(plainTitleText('<span class="math-tex">\\(E=mc^2\\)</span>'))
            .toBe("\\(E=mc^2\\)");
        expect(plainTitleText('<ol data-footnote-section=""><li>see Linnaeus</li></ol>'))
            .toBe("see Linnaeus");
    });
});

describe("plainTitleText / searchableTitleText", () => {
    it("strips markup, and #searchTitle replaces the heading for scoring", () => {
        expect(plainTitleText("*Rosa canina*")).toBe("Rosa canina");
        expect(plainTitleText("H<sub>2</sub>O")).toBe("H2O");
        expect(searchableTitleText("*Rosa canina*")).toBe("Rosa canina");
        expect(searchableTitleText("*Rosa canina*", [ "dog rose" ])).toBe("dog rose");
        expect(searchableTitleText("Plain", [ "", "alias" ])).toBe("alias");
        expect(titleToEditorData("*Rosa*")).toBe("<em>Rosa</em>");
        expect(titleToEditorData("<p><em>Rosa</em></p>")).toBe("<p><em>Rosa</em></p>");
    });
});
