import "./LocationEditor.css";

import clsx from "clsx";
import type { TargetedClipboardEvent, TargetedKeyboardEvent } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { copyTextWithToast } from "../../../services/clipboard_ext";
import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import FormTextBox from "../../react/FormTextBox";
import { useUniqueName } from "../../react/hooks";
import { MapSpaceContext } from "./space";

/**
 * Edits one marker's position as two fields: latitude and longitude on a geo map, x and y on an
 * image map. A pair or a map link pasted into either field fills both, and the copy button copies
 * the position the marker is standing at.
 */
export default function LocationEditor({ coordinates, location, onMove }: {
    /** Where the marker stands, as `[lng, lat]`. */
    coordinates: [number, number];
    /** The position label as stored, so an unchanged value is not written again. */
    location: string;
    onMove(point: [number, number]): Promise<unknown> | void;
}) {
    const space = useContext(MapSpaceContext);
    const hintId = useUniqueName("geo-location-hint");
    const initial = axesOf(space.formatLocation(coordinates));

    const [ primary, setPrimary ] = useState(initial[0]);
    const [ secondary, setSecondary ] = useState(initial[1]);
    const [ primaryDirty, setPrimaryDirty ] = useState(false);
    const [ secondaryDirty, setSecondaryDirty ] = useState(false);
    const [ invalid, setInvalid ] = useState(false);

    const live = useRef(coordinates);
    const primaryRef = useRef(primary);
    const secondaryRef = useRef(secondary);
    const primaryDirtyRef = useRef(false);
    const secondaryDirtyRef = useRef(false);
    const locationRef = useRef(location);
    const spaceRef = useRef(space);
    const onMoveRef = useRef(onMove);
    const selectAfter = useRef(false);
    const expecting = useRef<string | null>(null);
    const pending = useRef<Pending | null>(null);
    const writing = useRef(false);
    const mounted = useRef(true);

    primaryRef.current = primary;
    secondaryRef.current = secondary;
    primaryDirtyRef.current = primaryDirty;
    secondaryDirtyRef.current = secondaryDirty;
    locationRef.current = location;
    spaceRef.current = space;
    onMoveRef.current = onMove;

    const dirty = primaryDirty || secondaryDirty;

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // Follows a position that landed, including one this editor wrote. A label that is not the one
    // just sent is an earlier write still on its way, and a field being typed in is left alone.
    useEffect(() => {
        const point = space.parseLocation(location);
        if (!point) return;
        if (expecting.current !== null && location !== expecting.current) return;
        expecting.current = null;
        if (primaryDirtyRef.current || secondaryDirtyRef.current) return;

        live.current = point;
        const [ nextPrimary, nextSecondary ] = axesOf(space.formatLocation(point));
        setPrimary((current) => current === nextPrimary ? current : nextPrimary);
        setSecondary((current) => current === nextSecondary ? current : nextSecondary);
        setInvalid(false);
    }, [ location, space ]);

    useLayoutEffect(() => {
        if (!selectAfter.current) return;
        selectAfter.current = false;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.closest(".geo-location-editor")) {
            active.select();
        }
    });

    function schedule(point: [number, number]) {
        const serialized = spaceRef.current.serializeLocation(point);
        if (serialized === locationRef.current && !pending.current && !writing.current) return;

        expecting.current = serialized;
        pending.current = { point, send: onMoveRef.current };
        void flush();
    }

    async function flush() {
        if (writing.current) return;
        writing.current = true;
        try {
            while (pending.current) {
                const job = pending.current;
                pending.current = null;
                try {
                    await job.send(job.point);
                } catch {
                    expecting.current = null;
                    if (!mounted.current) break;
                    restore(spaceRef.current.parseLocation(locationRef.current));
                    break;
                }
            }
        } finally {
            writing.current = false;
            if (pending.current) void flush();
        }
    }

    function restore(point: [number, number] | null) {
        if (!point) return;
        live.current = point;
        const [ nextPrimary, nextSecondary ] = axesOf(spaceRef.current.formatLocation(point));
        primaryRef.current = nextPrimary;
        secondaryRef.current = nextSecondary;
        setPrimary(nextPrimary);
        setSecondary(nextSecondary);
    }

    function apply(point: [number, number]) {
        const spaceNow = spaceRef.current;
        const serialized = spaceNow.serializeLocation(point);
        const unchanged = serialized === spaceNow.serializeLocation(live.current);
        live.current = point;
        primaryDirtyRef.current = false;
        secondaryDirtyRef.current = false;
        setPrimaryDirty(false);
        setSecondaryDirty(false);
        setInvalid(false);
        const [ nextPrimary, nextSecondary ] = axesOf(spaceNow.formatLocation(point));
        primaryRef.current = nextPrimary;
        secondaryRef.current = nextSecondary;
        setPrimary(nextPrimary);
        setSecondary(nextSecondary);
        selectAfter.current = true;
        if (!unchanged) schedule(point);
    }

    function readPoint(): [number, number] | null {
        const spaceNow = spaceRef.current;
        const [ shownPrimary, shownSecondary ] = axesOf(spaceNow.formatLocation(live.current));
        const [ fullPrimary, fullSecondary ] = axesOf(spaceNow.formatLocation(live.current, true));
        const primaryText = primaryRef.current;
        const secondaryText = secondaryRef.current;
        const primaryIsDirty = primaryDirtyRef.current;
        const secondaryIsDirty = secondaryDirtyRef.current;

        // A map link or a pair pasted into one box names both axes.
        if (primaryIsDirty && !secondaryIsDirty) {
            const pasted = spaceNow.parseInput(primaryText);
            if (pasted) return pasted;
        }
        if (secondaryIsDirty && !primaryIsDirty) {
            const pasted = spaceNow.parseInput(secondaryText);
            if (pasted) return pasted;
        }

        if (spaceNow.kind === "geo") {
            const [ lng, lat ] = live.current;
            const nextLat = axisNumber(primaryText, primaryIsDirty, shownPrimary, lat);
            const nextLng = axisNumber(secondaryText, secondaryIsDirty, shownSecondary, lng);
            if (nextLat === null || nextLng === null) return null;
            // The same limits `parseCoordinates` applies to a typed pair.
            if (Math.abs(nextLat) > 90 || Math.abs(nextLng) > 180) return null;
            return [ nextLng, nextLat ];
        }

        const x = axisText(primaryText, primaryIsDirty, shownPrimary, fullPrimary);
        const y = axisText(secondaryText, secondaryIsDirty, shownSecondary, fullSecondary);
        if (x === null || y === null) return null;
        return spaceNow.parseInput(`${x}, ${y}`);
    }

    function commitDraft() {
        if (!primaryDirtyRef.current && !secondaryDirtyRef.current) return;
        const parsed = readPoint();
        if (!parsed) {
            setInvalid(true);
            return;
        }
        apply(parsed);
    }

    function revert() {
        primaryDirtyRef.current = false;
        secondaryDirtyRef.current = false;
        setPrimaryDirty(false);
        setSecondaryDirty(false);
        setInvalid(false);
        restore(live.current);
    }

    function onPaste(event: TargetedClipboardEvent<HTMLInputElement>) {
        const text = event.clipboardData?.getData("text") ?? "";
        const parsed = space.parseInput(text);
        if (!parsed) return;
        event.preventDefault();
        apply(parsed);
    }

    function onFieldKeyDown(event: TargetedKeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
            selectAfter.current = true;
            return;
        }
        if (event.key === "Escape" && (primaryDirtyRef.current || secondaryDirtyRef.current)) {
            event.preventDefault();
            event.stopPropagation();
            revert();
        }
    }

    function editPrimary(value: string) {
        primaryRef.current = value;
        primaryDirtyRef.current = true;
        setPrimary(value);
        setPrimaryDirty(true);
        if (invalid) setInvalid(false);
    }

    function editSecondary(value: string) {
        secondaryRef.current = value;
        secondaryDirtyRef.current = true;
        setSecondary(value);
        setSecondaryDirty(true);
        if (invalid) setInvalid(false);
    }

    const labels = space.kind === "geo"
        ? [ t("geo-map.latitude"), t("geo-map.longitude") ]
        : [ t("geo-map.axis-x"), t("geo-map.axis-y") ];
    const hint = invalid
        ? t("geo-map.coordinates-unreadable")
        : t(space.kind === "geo" ? "geo-map.coordinates-hint" : "geo-map.coordinates-hint-image");

    return (
        <div
            className={clsx("geo-location-editor", invalid && "invalid")}
            data-dirty={dirty ? "true" : undefined}
        >
            <div className="geo-location-line">
                <div className="geo-location-axes">
                    <AxisField
                        label={labels[0]}
                        className="geo-location-primary"
                        value={primary}
                        invalid={invalid}
                        describedBy={hintId}
                        onValue={editPrimary}
                        onCommit={(value) => {
                            primaryRef.current = value;
                            commitDraft();
                        }}
                        onKeyDown={onFieldKeyDown}
                        onPaste={onPaste}
                    />
                    <AxisField
                        label={labels[1]}
                        className="geo-location-secondary"
                        value={secondary}
                        invalid={invalid}
                        describedBy={hintId}
                        onValue={editSecondary}
                        onCommit={(value) => {
                            secondaryRef.current = value;
                            commitDraft();
                        }}
                        onKeyDown={onFieldKeyDown}
                        onPaste={onPaste}
                    />
                </div>
                <ActionButton
                    className="geo-location-copy"
                    icon="bx bx-copy"
                    text={t("geo-map.copy-coordinates")}
                    onClick={() => copyTextWithToast(space.formatLocation(live.current, true))}
                />
            </div>
            <p id={hintId} className={invalid ? "geo-location-error" : "geo-location-hint"}>
                {hint}
            </p>
        </div>
    );
}

function AxisField({
    label, className, value, invalid, describedBy, onValue, onCommit, onKeyDown, onPaste
}: {
    label: string;
    className: string;
    value: string;
    invalid: boolean;
    describedBy: string;
    onValue(value: string): void;
    onCommit(value: string): void;
    onKeyDown(event: TargetedKeyboardEvent<HTMLInputElement>): void;
    onPaste(event: TargetedClipboardEvent<HTMLInputElement>): void;
}) {
    return (
        <label className="geo-location-axis">
            <span>{label}</span>
            <FormTextBox
                className={className}
                currentValue={value}
                spellcheck={false}
                autoComplete="off"
                inputMode="decimal"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onChange={onValue}
                onBlur={onCommit}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
            />
        </label>
    );
}

interface Pending {
    point: [number, number];
    send: (point: [number, number]) => Promise<unknown> | void;
}

/** The two numbers `formatLocation` writes, the first being latitude or x. */
function axesOf(formatted: string): [string, string] {
    const comma = formatted.indexOf(", ");
    if (comma < 0) return [ formatted, "" ];
    return [ formatted.slice(0, comma), formatted.slice(comma + 2) ];
}

/** A decimal the reader typed, or `null` when `text` is not one. */
function plainNumber(text: string): number | null {
    const trimmed = text.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
}

/**
 * The number a field commits. An axis the reader has not changed, or has put back to the rounded
 * value on screen, keeps the stored digits. Anything else is what they typed.
 */
function axisNumber(typed: string, dirty: boolean, shown: string, exact: number): number | null {
    if (!dirty) return exact;
    const value = plainNumber(typed);
    if (value === null) return null;
    if (typed.trim() === shown || value === plainNumber(shown)) return exact;
    return value;
}

/** `axisNumber` as text an image map parses, so a stored coordinate is not re-rounded. */
function axisText(typed: string, dirty: boolean, shown: string, full: string): string | null {
    if (!dirty) return full;
    const value = plainNumber(typed);
    if (value === null) return null;
    if (typed.trim() === shown || value === plainNumber(shown)) return full;
    return typed.trim();
}
