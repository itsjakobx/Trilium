const ALLOWED_TAGS = new Set(["em", "i", "strong", "b", "sub", "sup", "u", "s", "mark", "span"]);
const SKIP_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "noscript"]);
const BLOCK_SEP_TAGS = new Set([
    "p", "div", "br", "tr", "td", "th", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "figure", "figcaption", "section", "pre", "ol", "ul", "table"
]);
const ALLOWED_STYLE_PROPS = new Set([
    "color",
    "background-color",
    "font-weight",
    "font-style",
    "font-size",
    "text-decoration",
    "vertical-align"
]);

const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'"
};

const TAG_SPLIT = /(<\/?(?:em|i|strong|b|sub|sup|u|s|mark|span)(?:\s[^>]*)?>)/gi;
const TAG_MATCH = /^<(\/)?([a-zA-Z][\w:-]*)((?:\s[^>]*)?)>/;
const ENTITY_MATCH = /^&([a-z]+|#\d+|#x[0-9a-f]+);/i;
const RICH_TAG = /<\/?(?:em|i|strong|b|sub|sup|u|s|mark|span|table|figure|section|ol|ul|math-tex)/i;
const LOOKS_LIKE_HTML = /<\/?[a-zA-Z]/;
const UNSAFE_STYLE_VALUE = /expression|url\s*\(|javascript/i;

/**
 * Escapes text so it is safe to insert into HTML.
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Compact HTML for the tree, links and prefixes. Keeps inline emphasis; unwraps blocks (tables,
 * footnotes, paragraphs) down to their text so a Fancytree row cannot grow a full table.
 */
export function formatDisplayTitle(title: string, prefix?: string | null): string {
    const html = sanitizeTitleHtml(applyInlineMarkdown(title));
    if (!prefix) {
        return html;
    }
    return `${escapeHtml(prefix)} - ${html}`;
}

/** Reads `note.title` and formats it. */
export function formatNoteDisplayTitle(note: { title: string }): string {
    return formatDisplayTitle(note.title);
}

/**
 * HTML the heading editor can load. Stored CKEditor markup is passed through; a plain or
 * `*markdown*` title is turned into inline tags first.
 */
export function titleToEditorData(title: string): string {
    if (!title) {
        return "";
    }
    if (LOOKS_LIKE_HTML.test(title)) {
        return title;
    }
    return formatDisplayTitle(title);
}

/**
 * Keeps only compact heading-safe tags (bold, italic, underline, sub/sup, mark, colored span).
 * Block tags and unknown tags are unwrapped to their text. Script/style content is dropped.
 */
export function sanitizeTitleHtml(html: string): string {
    return sanitizeDisplayHtml(html).html;
}

/**
 * Search text for a note heading. With no `#searchTitle`, this is the heading with markup
 * stripped. When `#searchTitle` is set, those values replace the heading for title scoring.
 */
export function searchableTitleText(title: string, searchTitles: string[] = []): string {
    const extras = searchTitles.filter((value) => value);
    if (extras.length > 0) {
        return extras.join(" ");
    }
    return plainTitleText(title);
}

/** Title with markdown / tags removed, for search and exact-match scoring. */
export function plainTitleText(title: string): string {
    return collapseSpaces(sanitizeDisplayHtml(applyInlineMarkdown(title)).text);
}

/** Whether the HTML actually carries allowed formatting. */
export function isRichDisplayTitle(html: string): boolean {
    return RICH_TAG.test(html);
}

function applyInlineMarkdown(input: string): string {
    const parts = input.split(TAG_SPLIT);
    const out: string[] = [];

    for (const [index, part] of parts.entries()) {
        if (index % 2 === 1) {
            out.push(part);
            continue;
        }
        out.push(applyMarkdownToText(part));
    }

    return out.join("");
}

function applyMarkdownToText(text: string): string {
    const withBold = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return withBold.replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function sanitizeDisplayHtml(input: string): { html: string; text: string } {
    let html = "";
    let text = "";
    const stack: string[] = [];
    let i = 0;

    while (i < input.length) {
        const ch = input[i];
        if (ch === "<") {
            const tag = consumeTag(input, i, stack);
            if (tag) {
                html += tag.html;
                text += tag.text;
                i += tag.length;
                continue;
            }
            html += "&lt;";
            text += "<";
            i += 1;
            continue;
        }
        if (ch === "&") {
            const entity = consumeEntity(input, i);
            if (entity) {
                html += escapeHtml(entity.char);
                text += entity.char;
                i += entity.length;
                continue;
            }
            html += "&amp;";
            text += "&";
            i += 1;
            continue;
        }
        html += escapeHtml(ch);
        text += ch;
        i += 1;
    }

    while (stack.length > 0) {
        const tag = stack.pop();
        if (tag) {
            html += `</${tag}>`;
        }
    }

    return { html: html.replace(/\s+/g, " ").trim(), text };
}

function consumeTag(
    input: string,
    start: number,
    stack: string[]
): { html: string; text: string; length: number } | null {
    const slice = input.slice(start);
    const match = TAG_MATCH.exec(slice);
    if (!match) {
        return null;
    }

    const isClose = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    const length = match[0].length;

    if (SKIP_CONTENT_TAGS.has(tag)) {
        return { html: "", text: "", length: skipElementLength(input, start, tag, length) };
    }

    if (!ALLOWED_TAGS.has(tag)) {
        const sep = BLOCK_SEP_TAGS.has(tag) && (isClose || tag === "br") ? " " : "";
        return { html: sep, text: sep, length };
    }

    if (isClose) {
        if (stack.at(-1) !== tag) {
            return { html: "", text: "", length };
        }
        stack.pop();
        return { html: `</${tag}>`, text: "", length };
    }

    const attrs = safeOpenAttrs(tag, match[3] ?? "");
    stack.push(tag);
    return { html: attrs ? `<${tag} ${attrs}>` : `<${tag}>`, text: "", length };
}

function skipElementLength(input: string, start: number, tag: string, openLength: number): number {
    const close = `</${tag}>`;
    const rest = input.slice(start + openLength).toLowerCase();
    const closeAt = rest.indexOf(close);
    if (closeAt < 0) {
        return input.length - start;
    }
    return openLength + closeAt + close.length;
}

function safeOpenAttrs(tag: string, raw: string): string {
    if (tag !== "span") {
        return "";
    }
    const styleMatch = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(raw);
    const style = styleMatch?.[1] ?? styleMatch?.[2] ?? "";
    if (!style || !isSafeStyle(style)) {
        return "";
    }
    return `style="${escapeHtml(style)}"`;
}

function isSafeStyle(style: string): boolean {
    for (const decl of style.split(";")) {
        const trimmed = decl.trim();
        if (!trimmed) {
            continue;
        }
        const colon = trimmed.indexOf(":");
        if (colon < 0) {
            return false;
        }
        const prop = trimmed.slice(0, colon).trim().toLowerCase();
        const value = trimmed.slice(colon + 1).trim();
        if (!ALLOWED_STYLE_PROPS.has(prop) || UNSAFE_STYLE_VALUE.test(value)) {
            return false;
        }
    }
    return true;
}

function consumeEntity(
    input: string,
    start: number
): { char: string; length: number } | null {
    const match = ENTITY_MATCH.exec(input.slice(start));
    if (!match) {
        return null;
    }

    const body = match[1];
    const named = NAMED_ENTITIES[body.toLowerCase()];
    if (named) {
        return { char: named, length: match[0].length };
    }

    const decoded = decodeNumericEntity(body);
    if (decoded === null) {
        return null;
    }
    return { char: decoded, length: match[0].length };
}

function decodeNumericEntity(body: string): string | null {
    if (!body.startsWith("#")) {
        return null;
    }

    const hex = body[1] === "x" || body[1] === "X";
    const num = hex
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(num) || num < 0 || num > 0x10ffff) {
        return null;
    }
    return String.fromCodePoint(num);
}

function collapseSpaces(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}
