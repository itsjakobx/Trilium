import "ckeditor5";

declare global {
    interface Component {
        triggerCommand(command: string, data?: unknown): void;
    }

    interface LinkEmbedMetadata {
        url: string;
        embedType: string;
        title?: string;
        description?: string;
        favicon?: string;
        siteName?: string;
        image?: string;
        /**
         * True when the host could not read the page (network error, bot challenge, non-HTML
         * response, or a page with no title of its own) and the fields above hold nothing but a
         * hostname-derived placeholder. Mirrors `LinkEmbedMetadata.unresolved` in
         * `@triliumnext/commons`, which is what the host actually returns.
         */
        unresolved?: boolean;
    }

    interface EditorComponent extends Component {
        loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string): Promise<void>;
        createNoteForReferenceLink(title: string, intoInbox: boolean): Promise<string | undefined>;
        loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>, boxSize?: string): void;
        /**
         * Mounts the live attribute editor into a property-block widget. The widget stores only
         * the attribute's type and name; values are read and written through froca.
         */
        renderPropertyBlock($el: JQuery<HTMLElement>, config: { attrType: string; attrName: string }): void;
        /**
         * Properties the slash catalog can place: definitions on the note plus owned attributes
         * that already hold a value, excluding ones already in the document.
         */
        getPropertyBlockCatalog(): Array<{
            attrType: "label" | "relation";
            attrName: string;
            title: string;
            aliases?: string[];
            iconClass?: string;
        }>;
        /**
         * Reads a page's preview metadata through the host. Never rejects: any failure — network
         * error, HTTP error, unparseable page — resolves as `{ unresolved: true }` with
         * hostname-derived placeholders, so callers branch on `unresolved` instead of catching.
         */
        fetchLinkMetadata(url: string): Promise<LinkEmbedMetadata>;
        detectEmbedType(url: string): string;
        renderLinkEmbed(container: HTMLElement, metadata: LinkEmbedMetadata, editable?: boolean): void;
        renderLinkMention(container: HTMLElement, metadata: Pick<LinkEmbedMetadata, "url" | "title" | "favicon">, editable?: boolean): void;
    }

    var glob: {
        getComponentByEl<T extends Component>(el: unknown): T;
        getActiveContextNote(): {
            noteId: string;
        };
        getHeaders(): Promise<Record<string, string>>;
        getReferenceLinkTitle(href: string): Promise<string>;
        getReferenceLinkTitleSync(href: string): string;
    }
}
