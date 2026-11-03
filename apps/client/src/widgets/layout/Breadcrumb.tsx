import "./Breadcrumb.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useContext, useRef, useState } from "preact/hooks";
import { Fragment } from "preact/jsx-runtime";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import contextMenu, { MenuItem } from "../../menus/context_menu";
import NoteColorPicker from "../../menus/custom-items/NoteColorPicker";
import link_context_menu from "../../menus/link_context_menu";
import { getDuplicateItems, TreeCommandNames } from "../../menus/tree_context_menu";
import attributes from "../../services/attributes";
import branches from "../../services/branches";
import { copyTextWithToast } from "../../services/clipboard_ext";
import { getReadableTextColor } from "../../services/css_class_manager";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import options from "../../services/options";
import tree from "../../services/tree";
import { escapeHtml } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import { Badge } from "../react/Badge";
import Dropdown from "../react/Dropdown";
import { FormListItem } from "../react/FormList";
import { useActiveNoteContext, useChildNotes, useNote, useNoteColorClass, useNoteIcon, useNoteLabel, useNoteLabelBoolean, useNoteTitle, useStaticTooltip, useTriliumOptionBool } from "../react/hooks";
import Icon from "../react/Icon";
import { MenuItemRows } from "../react/Menu";
import { NewNoteLink } from "../react/NoteLink";
import { ParentComponent } from "../react/react_utils";

const PROTECTED_ICON = "bx bx-lock-alt protected-icon";
const COLLAPSE_THRESHOLD = 5;
const INITIAL_ITEMS = 2;
const FINAL_ITEMS = 3;

export default function Breadcrumb() {
    const { notePath, notePaths, noteContext, hoistStack } = useNotePaths();
    const parentComponent = useContext(ParentComponent);
    const [ hideArchivedNotes ] = useTriliumOptionBool("hideArchivedNotes_main");
    const separatorProps: Omit<BreadcrumbSeparatorProps, "notePath" | "activeNotePath"> = { noteContext, hideArchivedNotes };
    const hoisted = hoistStack.length > 1;
    const itemProps = { noteContext, parentComponent, hoisted };

    return (
        <div className="breadcrumb">
            {hoisted && (
                <>
                    <HoistTrail stack={hoistStack} noteContext={noteContext} />
                    <span className="breadcrumb-hoist-divider" role="separator" aria-hidden="true" />
                </>
            )}
            <BreadcrumbTrack
                paths={notePaths}
                renderItem={(path, index) => (
                    <BreadcrumbItem index={index} notePath={path} notePathLength={notePaths.length} {...itemProps} />
                )}
                renderSeparator={(notePath, nextPath) => (
                    <BreadcrumbSeparator notePath={notePath} activeNotePath={nextPath} {...separatorProps} />
                )}
                onCollapsedSelect={(path) => noteContext?.setNote(path)}
            />

            <div
                className="filler"
                onContextMenu={buildEmptyAreaContextMenu(parentComponent, notePath)}
            />
        </div>
    );
}

function BreadcrumbRoot({ noteContext, resetHoisting }: { noteContext: NoteContext | undefined; resetHoisting?: boolean }) {
    // Root note is icon only. In the hoist trail it clears every nested hoist; in the ordinary
    // breadcrumb it opens the root note.
    const note = froca.getNoteFromCache("root");
    return (note &&
        <ActionButton
            className="root-note"
            icon={note.getIcon()}
            text={""}
            onClick={() => {
                if (resetHoisting) {
                    void noteContext?.unhoistAll();
                } else {
                    void noteContext?.setNote(note.noteId);
                }
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                link_context_menu.openContextMenu(note.noteId, e);
            }}
        />
    );
}

/**
 * One row for both header segments. The crumbs and the dots fold are shared. The note path's
 * chevron lists children; the hoist trail's chevron is only a mark between hoists. A crumb opens
 * the note on the right and unhoists down to it on the left.
 */
function BreadcrumbTrack({ paths, renderItem, renderSeparator, onCollapsedSelect, trailingSeparator = true }: {
    paths: string[];
    renderItem: (notePath: string, index: number) => ComponentChildren;
    renderSeparator: (notePath: string, nextPath: string | undefined) => ComponentChildren;
    onCollapsedSelect: (notePath: string) => void;
    /** The note path keeps a chevron after its last crumb. The hoist trail ends at the divider. */
    trailingSeparator?: boolean;
}) {
    const separatorAfter = (index: number) => trailingSeparator || index < paths.length - 1;

    if (paths.length <= COLLAPSE_THRESHOLD) {
        return (
            <>
                {paths.map((notePath, index) => (
                    <Fragment key={notePath}>
                        {renderItem(notePath, index)}
                        {separatorAfter(index) && renderSeparator(notePath, paths[index + 1])}
                    </Fragment>
                ))}
            </>
        );
    }

    const head = paths.slice(0, INITIAL_ITEMS);
    const middle = paths.slice(INITIAL_ITEMS, -FINAL_ITEMS);
    const tailStart = paths.length - FINAL_ITEMS;
    return (
        <>
            {head.map((notePath, index) => (
                <Fragment key={notePath}>
                    {renderItem(notePath, index)}
                    {renderSeparator(notePath, paths[index + 1])}
                </Fragment>
            ))}
            <BreadcrumbCollapsed items={middle} onSelect={onCollapsedSelect} />
            {paths.slice(tailStart).map((notePath, index) => {
                const absolute = tailStart + index;
                return (
                    <Fragment key={notePath}>
                        {renderSeparator(paths[absolute - 1], notePath)}
                        {renderItem(notePath, absolute)}
                        {trailingSeparator && absolute === paths.length - 1 && renderSeparator(notePath, undefined)}
                    </Fragment>
                );
            })}
        </>
    );
}

/**
 * The left side of the header while at least one note is hoisted: root, then each nested hoist.
 * A workspace is a badge in its own color and icon. Any other hoist is a text pill. Clicking one
 * pops the trail down to that note and keeps every hoist above it.
 */
export function HoistTrail({ stack, noteContext }: {
    stack: string[];
    noteContext: NoteContext | undefined;
}) {
    const activeId = stack.at(-1);

    return (
        <nav className="breadcrumb-hoist-trail" aria-label={t("breadcrumb.hoist_trail")}>
            <BreadcrumbTrack
                paths={stack}
                trailingSeparator={false}
                onCollapsedSelect={(noteId) => selectHoistPath(noteContext, noteId, false)}
                renderSeparator={() => <HoistChevron />}
                renderItem={(noteId) => {
                    if (noteId === "root") return <BreadcrumbRoot noteContext={noteContext} resetHoisting />;
                    return <HoistTrailNote noteId={noteId} noteContext={noteContext} active={noteId === activeId} />;
                }}
            />
        </nav>
    );
}

/** A mark between hoists. The children of a hoist are reached from the note path, not from here. */
function HoistChevron() {
    return (
        <span className="breadcrumb-hoist-chevron" aria-hidden="true">
            <Icon icon="bx bxs-chevron-right" />
        </span>
    );
}

function selectHoistPath(noteContext: NoteContext | undefined, notePath: string, active: boolean) {
    const noteId = notePath.split("/").at(-1);
    if (!noteId) return;
    const workspace = !!froca.getNoteFromCache(noteId)?.isLabelTruthy("workspace");
    selectHoist(noteContext, noteId, active, workspace);
}

function selectHoist(noteContext: NoteContext | undefined, noteId: string, active: boolean, workspace: boolean) {
    if (!noteContext) return;
    // A workspace is the boundary of its sandbox: open that note, not whatever descendant
    // happened to be showing. Any other hoist only shortens the trail.
    if (workspace) {
        void noteContext.setHoistedNoteId(noteId, { activateHoistedNote: true });
    } else if (active) {
        void noteContext.setNote(noteId);
    } else {
        void noteContext.setHoistedNoteId(noteId);
    }
}

function HoistTrailNote({ noteId, noteContext, active }: { noteId: string; noteContext: NoteContext | undefined; active: boolean }) {
    const note = useNote(noteId);
    const noteIcon = useNoteIcon(note);
    const [ workspace ] = useNoteLabelBoolean(note, "workspace");
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");
    const [ workspaceColor ] = useNoteLabel(note, "workspaceTabBackgroundColor");
    if (!note) return null;

    const title = note.isContentAvailable() ? note.title : t("protected_session.locked_note_title");
    const onClick = () => selectHoist(noteContext, noteId, active, workspace);

    if (workspace) {
        const icon = workspaceIconClass || noteIcon;
        return (
            <Badge
                className={clsx("badge-hoisted", "badge-workspace", active && "is-active")}
                icon={icon}
                text={<BreadcrumbNoteTitle note={note} />}
                tooltip={t("breadcrumb.workspace_reset", { title })}
                onClick={onClick}
                style={workspaceColor ? {
                    "--color": workspaceColor,
                    "color": getReadableTextColor(workspaceColor)
                } : undefined}
            />
        );
    }

    return (
        <button
            type="button"
            className={clsx("breadcrumb-hoist-pill", active && "is-active")}
            data-note-id={noteId}
            title={t("breadcrumb.unhoist_to", { title })}
            onClick={onClick}
        >
            <BreadcrumbNoteTitle note={note} />
        </button>
    );
}

function BreadcrumbLastItem({ notePath, parentComponent }: { notePath: string, parentComponent: Component | null }) {
    const linkRef = useRef<HTMLAnchorElement>(null);
    const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
    // A hoisted tab can render before its note path arrives. An empty id makes froca throw.
    const [ note ] = useState(() => noteId ? froca.getNoteFromCache(noteId) : undefined);
    const title = useNoteTitle(noteId, parentNoteId);
    const colorClass = useNoteColorClass(note);
    const [ archived ] = useNoteLabelBoolean(note, "archived");
    useStaticTooltip(linkRef, {
        placement: "top",
        title: t("breadcrumb.scroll_to_top_title")
    });

    if (!note) return null;

    return (
        <a
            ref={linkRef}
            href="#"
            className={clsx("breadcrumb-last-item tn-link", colorClass, archived && "archived")}
            onClick={() => {
                const activeNtxId = appContext.tabManager.activeNtxId;
                const scrollingContainer = document.querySelector(`[data-ntx-id="${activeNtxId}"] .scrolling-container`);
                scrollingContainer?.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onContextMenu={buildContextMenu(notePath, parentComponent)}
        >{title}</a>
    );
}

function BreadcrumbItem({ index, notePath, noteContext, notePathLength, parentComponent, hoisted }: { index: number, notePathLength: number, notePath: string, noteContext: NoteContext | undefined, parentComponent: Component | null, hoisted: boolean }) {
    // While hoisted, the path is already anchored at the active hoist, so its first crumb is that
    // note rather than the global root (the root lives on the hoist trail).
    if (index === 0 && !hoisted) {
        return <BreadcrumbRoot noteContext={noteContext} />;
    }

    if (index === notePathLength - 1) {
        return <>
            <BreadcrumbLastItem notePath={notePath} parentComponent={parentComponent} />
        </>;
    }

    return <NewNoteLink
        notePath={notePath}
        noContextMenu
        onContextMenu={buildContextMenu(notePath, parentComponent)}
    />;
}

interface BreadcrumbSeparatorProps {
    notePath: string | undefined,
    activeNotePath?: string,
    noteContext: NoteContext | undefined,
    hideArchivedNotes: boolean;
}

export function BreadcrumbSeparator(props: BreadcrumbSeparatorProps) {
    const notePathComponents = (props.notePath ?? "").split("/");
    const parentNoteId = notePathComponents.at(-1);
    const parentNote = useNote(parentNoteId);
    const [ subtreeHidden ] = useNoteLabelBoolean(parentNote, "subtreeHidden");

    if (subtreeHidden && !props.activeNotePath) {
        return null;
    }

    return (
        <Dropdown
            text={<Icon icon="bx bxs-chevron-right" />}
            noSelectButtonStyle
            buttonClassName="icon-action breadcrumb-separator"
            hideToggleArrow
            dropdownContainerClassName="breadcrumb-child-list"
            placement="top"
            filterable={!!parentNote?.hasChildren()}
            keepOrder
        >
            <BreadcrumbSeparatorDropdownContent {...props} />
        </Dropdown>
    );
}

function BreadcrumbSeparatorDropdownContent(props: BreadcrumbSeparatorProps) {
    const parentNoteId = (props.notePath ?? "").split("/").at(-1);
    const childNotes = useChildNotes(parentNoteId);
    return <MenuItemRows items={buildChildNoteItems(childNotes, props)} />;
}

/** The rows of a separator's menu: the children of the note before it, then "Create new note". */
export function buildChildNoteItems(childNotes: FNote[], props: BreadcrumbSeparatorProps) {
    const { notePath, activeNotePath, noteContext, hideArchivedNotes } = props;
    const items: MenuItem<unknown>[] = [];
    for (const note of childNotes) {
        if (note.noteId === "_hidden") continue;
        if (hideArchivedNotes && note.isArchived) continue;

        const childNotePath = `${notePath}/${note.noteId}`;
        const title = noteTitleTextHtml(note);
        items.push({
            title: childNotePath === activeNotePath ? `<strong>${title}</strong>` : title,
            titleIcon: note.isProtected ? PROTECTED_ICON : undefined,
            uiIcon: note.getIcon(),
            iconColorClass: note.getColorClass(),
            className: note.isArchived ? "archived" : undefined,
            handler: () => noteContext?.setNote(childNotePath)
        });
    }

    if (items.length > 0) items.push({ kind: "separator" });
    items.push({
        title: t("breadcrumb.create_new_note"),
        uiIcon: "bx bx-plus",
        handler: () => note_create.createNote(notePath, { activate: true })
    });
    return items;
}

/** The HTML of {@link BreadcrumbNoteTitle}, with the lock of a protected note. */
export function noteTitleHtml(note: FNote) {
    const title = noteTitleTextHtml(note);
    return note.isProtected ? `${title}<span class="${PROTECTED_ICON} tn-icon"></span>` : title;
}

/** The HTML of the note's title, or of "Protected" while the protected session is locked. */
function noteTitleTextHtml(note: FNote) {
    if (note.isContentAvailable()) return escapeHtml(note.title);
    const locked = escapeHtml(t("protected_session.locked_note_title"));
    return `<span class="protected-title">${locked}</span>`;
}

function BreadcrumbCollapsed({ items, onSelect }: {
    items: string[],
    onSelect: (notePath: string) => void,
}) {
    return (
        <Dropdown
            text={<Icon icon="bx bx-dots-horizontal-rounded" />}
            noSelectButtonStyle
            buttonClassName="icon-action"
            dropdownContainerClassName="breadcrumb-child-list"
            hideToggleArrow
        >
            {items.map((notePath) => (
                <CollapsedCrumb key={notePath} notePath={notePath} onSelect={onSelect} />
            ))}
        </Dropdown>
    );
}

function CollapsedCrumb({ notePath, onSelect }: { notePath: string; onSelect: (notePath: string) => void }) {
    const noteId = notePath.split("/").at(-1);
    const note = useNote(noteId);
    const noteIcon = useNoteIcon(note);
    const [ workspace ] = useNoteLabelBoolean(note, "workspace");
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");
    if (!note) return null;

    return (
        <li>
            <FormListItem
                icon={workspace ? (workspaceIconClass || noteIcon) : note.getIcon()}
                onClick={() => onSelect(notePath)}
            >
                <span><BreadcrumbNoteTitle note={note} /></span>
            </FormListItem>
        </li>
    );
}

export function BreadcrumbNoteTitle({ note }: { note: FNote }) {
    return (
        <>
            {note.isContentAvailable()
                ? note.title
                : <span className="protected-title">{t("protected_session.locked_note_title")}</span>}
            {note.isProtected && <Icon icon="bx bx-lock-alt" className="protected-icon" />}
        </>
    );
}

function useNotePaths() {
    const { note, notePath, hoistedNoteId, noteContext, hoistStack } = useActiveNoteContext();
    // No path yet (a hoisted tab still opening, or an empty one) is an empty trail, not a blank id.
    const notePathArray = notePath ? notePath.split("/").filter(Boolean) : [];

    let prefix = "";
    let output: string[] = [];
    let pos = 0;
    let hoistedNotePos = -1;
    for (const notePath of notePathArray) {
        if (hoistedNoteId !== "root" && notePath === hoistedNoteId) {
            hoistedNotePos = pos;
        }
        output.push(`${prefix}${notePath}`);
        prefix += `${notePath}/`;
        pos++;
    }

    // When hoisted, display only the path starting with the hoisted note.
    if (hoistedNoteId !== "root" && hoistedNotePos > -1) {
        output = output.slice(hoistedNotePos);
    }

    return {
        note,
        notePath,
        notePaths: output,
        noteContext,
        hoistStack: hoistStack?.length ? hoistStack : [ "root" ]
    };
}

//#region Note Context menu
function buildContextMenu(notePath: string, parentComponent: Component | null) {
    return async (e: MouseEvent) => {
        e.preventDefault();

        const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
        if (!parentNoteId || !noteId) return;

        const branchId = await froca.getBranchId(parentNoteId, noteId);
        if (!branchId) return;
        const branch = froca.getBranch(branchId);
        if (!branch) return;

        const note = await branch?.getNote();
        if (!note) return;

        const notSearch = note.type !== "search";
        const notOptionsOrHelp = !note.noteId.startsWith("_options") && !note.noteId.startsWith("_help");
        const isArchived = note.isArchived;
        const isNotRoot = note.noteId !== "root";
        const isHoisted = note.noteId === appContext.tabManager.getActiveContext()?.hoistedNoteId;
        const parentNote = isNotRoot && branch ? await froca.getNote(branch.parentNoteId) : null;
        const parentNotSearch = !parentNote || parentNote.type !== "search";

        const items = [
            ...link_context_menu.getItems(e),
            {
                title: `${t("tree-context-menu.hoist-note")}`,
                command: "toggleNoteHoisting",
                uiIcon: "bx bxs-chevrons-up",
                enabled: notSearch
            },
            { kind: "separator" },
            {
                title: t("tree-context-menu.move-to"),
                command: "moveNotesTo",
                uiIcon: "bx bx-transfer",
                enabled: isNotRoot && !isHoisted && parentNotSearch
            },
            {
                title: t("tree-context-menu.clone-to"),
                command: "cloneNotesTo",
                uiIcon: "bx bx-duplicate",
                enabled: isNotRoot && !isHoisted
            },
            { kind: "separator" },
            {
                title: t("tree-context-menu.duplicate"),
                command: "duplicateSubtree",
                uiIcon: "bx bx-outline",
                enabled: parentNotSearch && isNotRoot && !isHoisted && notOptionsOrHelp && note.isContentAvailable(),
                items: getDuplicateItems([ note ])
            },

            {
                title: !isArchived ? t("tree-context-menu.archive") : t("tree-context-menu.unarchive"),
                uiIcon: !isArchived ? "bx bx-archive" : "bx bx-archive-out",
                handler: () => {
                    if (!isArchived) {
                        attributes.addLabel(note.noteId, "archived");
                    } else {
                        attributes.removeOwnedLabelByName(note, "archived");
                    }
                }
            },
            {
                title: t("tree-context-menu.delete"),
                command: "deleteNotes",
                uiIcon: "bx bx-trash destructive-action-icon",
                enabled: isNotRoot && !isHoisted && parentNotSearch && notOptionsOrHelp,
                handler: () => branches.deleteNotes([ branchId ])
            },
            { kind: "separator" },
            (notOptionsOrHelp ? {
                kind: "custom",
                componentFn: () => {
                    return NoteColorPicker({note});
                }
            } : null),
            { kind: "separator" },
            {
                title: t("tree-context-menu.recent-changes-in-subtree"),
                uiIcon: "bx bx-history",
                enabled: notOptionsOrHelp,
                handler: () => parentComponent?.triggerCommand("showRecentChanges", { ancestorNoteId: noteId })
            },
            {
                title: t("tree-context-menu.search-in-subtree"),
                command: "searchInSubtree",
                uiIcon: "bx bx-search",
                enabled: notSearch
            }
        ];

        contextMenu.show({
            items: items.filter(Boolean) as MenuItem<TreeCommandNames>[],
            x: e.pageX,
            y: e.pageY,
            selectMenuItemHandler: ({ command }) => {
                if (link_context_menu.handleLinkContextMenuItem(command, e, notePath)) {
                    return;
                }

                if (!command) return;
                parentComponent?.triggerCommand(command, {
                    noteId,
                    notePath,
                    selectedOrActiveBranchIds: [ branchId ],
                    selectedOrActiveNoteIds: [ noteId ]
                });
            },
        });
    };
}
//#endregion

//#region Empty context menu
function buildEmptyAreaContextMenu(parentComponent: Component | null, notePath: string | null | undefined) {
    return (e: MouseEvent) => {
        const hideArchivedNotes = (options.get("hideArchivedNotes_main") === "true");

        e.preventDefault();
        contextMenu.show({
            items: [
                {
                    title: t("breadcrumb.empty_hide_archived_notes"),
                    handler: async () => {
                        await options.save("hideArchivedNotes_main", !hideArchivedNotes ? "true" : "false");

                        // Note tree doesn't update by itself.
                        parentComponent?.triggerEvent("frocaReloaded", {});
                    },
                    checked: hideArchivedNotes
                },
                { kind: "separator" },
                {
                    title: t("tree-context-menu.copy-note-path-to-clipboard"),
                    command: "copyNotePathToClipboard",
                    uiIcon: "bx bx-directions",
                    handler: () => copyTextWithToast(`#${notePath}`)
                },
            ],
            x: e.pageX,
            y: e.pageY,
            selectMenuItemHandler: () => {}
        });
    };
}
//#endregion
