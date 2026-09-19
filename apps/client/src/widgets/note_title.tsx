import "./note_title.css";

import { CKTextEditor, EditorWatchdog, SnippetDefinition } from "@triliumnext/ckeditor5";
import { escapeHtml, titleToEditorData } from "@triliumnext/commons";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../components/app_context";
import branches from "../services/branches";
import { t } from "../services/i18n";
import protected_session_holder from "../services/protected_session_holder";
import { sanitizeNoteContentHtml } from "../services/sanitize_content";
import server from "../services/server";
import { isHtmlEmpty } from "../services/utils";
import { useNoteContext, useNoteLabel, useNoteProperty, useSpacedUpdate, useTriliumEvents } from "./react/hooks";
import CKEditorWithWatchdog, { CKEditorApi } from "./type_widgets/text/CKEditorWithWatchdog";
import { ReadOnlyTextContent } from "./type_widgets/text/ReadOnlyText";

const NO_SNIPPETS: SnippetDefinition[] = [];

export default function NoteTitleWidget(props: {className?: string}) {
    const { note, noteId, componentId, viewScope, noteContext, parentComponent } = useNoteContext();
    const title = useNoteProperty(note, "title", componentId);
    const isProtected = useNoteProperty(note, "isProtected");
    const [ language ] = useNoteLabel(note, "language");
    const newTitle = useRef("");
    const isNewNote = useRef<boolean>();
    const pendingSelect = useRef<boolean>(false);
    const watchdogRef = useRef<EditorWatchdog>(null);
    const editorApiRef = useRef<CKEditorApi>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef(title);
    titleRef.current = title;

    const [ isReadOnly, setReadOnly ] = useState<boolean>(false);
    const [ navigationTitle, setNavigationTitle ] = useState<string | null>(null);
    const [ editing, setEditing ] = useState(false);

    useEffect(() => {
        const nextReadOnly = note === null
            || note === undefined
            || (note.isProtected && !protected_session_holder.isProtectedSessionAvailable())
            || note.isMetadataReadOnly
            || viewScope?.viewMode !== "default";
        setReadOnly(nextReadOnly);
        if (nextReadOnly) {
            setEditing(false);
        }
    }, [ note, note?.noteId, note?.isProtected, viewScope?.viewMode ]);

    useEffect(() => {
        if (isReadOnly) {
            noteContext?.getNavigationTitle().then(setNavigationTitle);
        }
    }, [note, isReadOnly]);

    useEffect(() => {
        setEditing(false);
    }, [noteId]);

    const spacedUpdate = useSpacedUpdate(async () => {
        if (!note) {
            return;
        }
        protected_session_holder.touchProtectedSessionIfNecessary(note);
        await server.put<void>(`notes/${noteId}/title`, { title: newTitle.current }, componentId);
    });

    useEffect(() => {
        const listener = () => spacedUpdate.isAllSavedAndTriggerUpdate();
        appContext.addBeforeUnloadListener(listener);
        return () => appContext.removeBeforeUnloadListener(listener);
    }, []);
    useTriliumEvents([ "beforeNoteSwitch", "beforeNoteContextRemove" ], () => spacedUpdate.updateNowIfNecessary());

    const onChange = useCallback(() => {
        const editor = watchdogRef.current?.editor;
        if (!editor) {
            return;
        }
        const data = editor.getData() ?? "";
        newTitle.current = isHtmlEmpty(data) ? "" : data;
        spacedUpdate.scheduleUpdate();
    }, [spacedUpdate]);

    const onEditorInitialized = useCallback((editor: CKTextEditor) => {
        editor.setData(titleToEditorData(titleRef.current ?? ""));
        editor.editing.view.document.on("keydown", (evt, data) => {
            const domEvent = data.domEvent as KeyboardEvent;
            if (domEvent.key === "Escape" && isNewNote.current && noteContext?.isActive() && note) {
                branches.deleteNotes(Object.values(note.parentToBranch));
                return;
            }
            if (domEvent.key === "Enter" && (domEvent.ctrlKey || domEvent.metaKey)) {
                data.preventDefault();
                evt.stop();
                parentComponent.triggerCommand("focusOnDetail", {
                    ntxId: noteContext?.ntxId,
                    insertNewlineAtTop: true
                });
            }
        }, { priority: "high" });
        editor.editing.view.focus();
        if (pendingSelect.current) {
            editor.execute("selectAll");
            pendingSelect.current = false;
        }
    }, [note, noteContext, parentComponent]);

    useTriliumEvents([ "focusOnTitle", "focusAndSelectTitle" ], (e, eventName) => {
        const isTargeted = e.ntxId ? e.ntxId === noteContext?.ntxId : noteContext?.isActive();
        if (!isTargeted || isReadOnly) {
            return;
        }
        if (!rootRef.current?.checkVisibility({ checkOpacity: true })) {
            return;
        }

        pendingSelect.current = eventName === "focusAndSelectTitle";
        isNewNote.current = ("isNewNote" in e ? e.isNewNote : false);
        setEditing(true);
        void focusTitleEditor(watchdogRef, pendingSelect);
    });

    const previewHtml = isReadOnly
        ? escapeHtml(navigationTitle ?? title ?? "")
        : sanitizeNoteContentHtml(titleToEditorData(title ?? ""));
    const titleClass = clsx("note-title", "ck-content", isProtected && "protected");

    return (
        <div ref={rootRef} className={clsx("note-title-widget", props.className)}>
            {note && isReadOnly && (
                <ReadOnlyTextContent className={titleClass} html={previewHtml} />
            )}
            {note && !isReadOnly && editing && (
                <CKEditorWithWatchdog
                    isClassicEditor={false}
                    className={titleClass}
                    tabIndex={100}
                    contentLanguage={language}
                    templates={NO_SNIPPETS}
                    watchdogRef={watchdogRef}
                    editorApi={editorApiRef}
                    placeholder={t("note_title.placeholder")}
                    onChange={onChange}
                    onEditorInitialized={onEditorInitialized}
                />
            )}
            {note && !isReadOnly && !editing && (
                <div
                    role="textbox"
                    data-placeholder={t("note_title.placeholder")}
                    data-empty={previewHtml ? "false" : "true"}
                    className={titleClass}
                    onFocus={() => setEditing(true)}
                    onClick={() => setEditing(true)}
                >
                    <ReadOnlyTextContent html={previewHtml} />
                </div>
            )}
        </div>
    );
}

async function focusTitleEditor(
    watchdogRef: { current: EditorWatchdog | null },
    pendingSelect: { current: boolean }
) {
    for (let attempt = 0; attempt < 80; attempt++) {
        const editor = watchdogRef.current?.editor;
        if (editor) {
            editor.editing.view.focus();
            if (pendingSelect.current) {
                editor.execute("selectAll");
                pendingSelect.current = false;
            }
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
