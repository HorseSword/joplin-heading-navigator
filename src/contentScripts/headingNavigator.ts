import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import { EDITOR_COMMAND_TOGGLE_PANEL } from '../constants';
import type { HeadingItem, PanelDimensions } from '../types';
import type { ContentScriptToPluginMessage } from '../messages';
import { extractHeadings } from '../headingExtractor';
import { HeadingPanel, type PanelCloseReason } from './ui/headingPanel';
import { normalizePanelDimensions } from '../panelDimensions';
import logger from '../logger';

// Track active verification timeouts per editor. WeakMap ensures automatic
// cleanup when editor instances are destroyed (e.g., note close, plugin reload).
const scrollVerificationTimeouts = new WeakMap<EditorView, number>();

function cancelPendingVerification(view: EditorView): void {
    const timeoutId = scrollVerificationTimeouts.get(view);
    if (typeof timeoutId === 'number') {
        window.clearTimeout(timeoutId);
        scrollVerificationTimeouts.delete(view);
    }
}

/**
 * Scroll Verification Constants
 *
 * These values are tuned for reliable heading navigation in documents with dynamic content
 * (images, rich markdown rendering, etc.) that can cause layout shifts after initial scroll.
 *
 * - SCROLL_VERIFY_DELAY_MS: Initial verification delay (~2 animation frames) to allow layout
 *   to settle after the first scroll attempt. This handles most common cases where content
 *   is still being measured/rendered.
 *
 * - SCROLL_VERIFY_RETRY_DELAY_MS: Second verification delay to guard against late layout
 *   shifts (e.g., images loading asynchronously). Longer than initial delay to give more
 *   time for deferred content to finish loading.
 *
 * - SCROLL_VERIFY_TOLERANCE_PX: Acceptable pixel distance below viewport top. Allows headings
 *   to be slightly offset (up to 12px) without triggering re-scroll, reducing scroll jitter
 *   for minor position variations.
 *
 * - SCROLL_VERIFY_NEGATIVE_TOLERANCE_PX: Stricter tolerance for content above viewport top
 *   (1.5px vs 12px). Headings scrolled slightly past the top are more visually jarring than
 *   those slightly below, so we re-scroll more aggressively in this case.
 *
 * - SCROLL_VERIFY_MAX_ATTEMPTS: Maximum verification attempts (2). Prevents infinite retry
 *   loops while allowing one re-check for late shifts. More attempts add diminishing value.
 */
const SCROLL_VERIFY_DELAY_MS = 160;
const SCROLL_VERIFY_RETRY_DELAY_MS = 260;
const SCROLL_VERIFY_TOLERANCE_PX = 12;
const SCROLL_VERIFY_NEGATIVE_TOLERANCE_PX = 1.5;
const SCROLL_VERIFY_MAX_ATTEMPTS = 2;

type ScrollVerificationMeasurement =
    | {
          status: 'geometry';
          selectionFrom: number;
          selectionTo: number;
          viewportTop: number;
          blockTopOffset: number;
      }
    | {
          status: 'retry';
          selectionFrom: number;
          selectionTo: number;
      };

function planScrollVerification(view: EditorView, attempt: number, run: () => void): void {
    // attempt is 0-based: 0 for the first verification pass, 1 for the second, etc.
    const delay = attempt === 0 ? SCROLL_VERIFY_DELAY_MS : SCROLL_VERIFY_RETRY_DELAY_MS;

    const timeoutId = window.setTimeout(() => {
        scrollVerificationTimeouts.delete(view);
        run();
    }, delay);

    scrollVerificationTimeouts.set(view, timeoutId);
}

function ensureEditorFocus(view: EditorView, shouldFocus: boolean): void {
    if (!shouldFocus) {
        return;
    }

    view.focus();
}

/**
 * Creates a scroll verification function that ensures a heading stays pinned to the viewport top.
 *
 * Why retry logic is needed:
 * In documents with dynamic content (images, rich markdown plugins, code blocks with syntax
 * highlighting), the initial scrollIntoView call may execute before all content has finished
 * rendering/measuring. This causes the target heading to shift position after scroll completes:
 *
 * 1. User navigates to heading
 * 2. Initial scroll positions heading at top
 * 3. Image below heading finishes loading (adds height)
 * 4. Heading is pushed down, no longer visible at top
 *
 * The retry mechanism guards against these late layout shifts:
 * - First verification (160ms): Checks position after most layout settles
 * - Second verification (260ms): Guards against deferred content (lazy-loaded images, etc.)
 * - Uses CodeMirror's requestMeasure to avoid layout thrashing
 * - Aborts if user moves cursor (selection changed)
 * - Stops after 2 attempts to prevent infinite loops
 *
 * @param options - Configuration for scroll verification
 * @param options.view - CodeMirror editor view instance
 * @param options.targetRange - Target selection range to verify (from/to positions)
 * @param options.focusEditor - Whether to restore editor focus after verification
 * @returns Verification function that accepts attempt number (0-based)
 */
function createScrollVerifier(options: {
    view: EditorView;
    targetRange: { from: number; to: number };
    focusEditor: boolean;
}): (attempt: number) => void {
    const { view, targetRange, focusEditor } = options;

    const verify = (attempt: number): void => {
        if (attempt >= SCROLL_VERIFY_MAX_ATTEMPTS) {
            return;
        }

        planScrollVerification(view, attempt, () => {
            view.requestMeasure({
                read(measureView): ScrollVerificationMeasurement | null {
                    const selection = measureView.state.selection.main;
                    if (!isSameSelection(selection, targetRange)) {
                        return null;
                    }

                    const blockMeasurement = measureSelectionBlock(measureView, selection);
                    if (!blockMeasurement) {
                        return {
                            status: 'retry',
                            selectionFrom: selection.from,
                            selectionTo: selection.to,
                        };
                    }

                    return {
                        status: 'geometry' as const,
                        selectionFrom: blockMeasurement.selectionFrom,
                        selectionTo: selection.to,
                        viewportTop: blockMeasurement.viewportTop,
                        blockTopOffset: blockMeasurement.blockTopOffset,
                    };
                },
                write(measurement, measureView) {
                    if (!measurement) {
                        return;
                    }

                    const selection = measureView.state.selection.main;
                    if (!isSameSelection(selection, measurement)) {
                        return;
                    }

                    if (measurement.status === 'retry') {
                        if (attempt + 1 >= SCROLL_VERIFY_MAX_ATTEMPTS) {
                            logger.warn('Scroll verification gave up after measurement failures', {
                                selection: targetRange,
                                attempts: attempt + 1,
                            });
                            return;
                        }

                        measureView.dispatch({
                            effects: EditorView.scrollIntoView(selection, { y: 'start' }),
                        });

                        ensureEditorFocus(measureView, focusEditor);

                        verify(attempt + 1);
                        return;
                    }

                    const tolerance = SCROLL_VERIFY_TOLERANCE_PX;
                    const offsetFromViewportTop = measurement.blockTopOffset;
                    const needsScroll =
                        offsetFromViewportTop < 0
                            ? Math.abs(offsetFromViewportTop) > SCROLL_VERIFY_NEGATIVE_TOLERANCE_PX
                            : offsetFromViewportTop > tolerance;

                    if (!needsScroll) {
                        // Stay on guard for late layout shifts (e.g. images loading) that can push the heading
                        // below the viewport top; extra checks keep it pinned even when content settles.
                        if (attempt + 1 < SCROLL_VERIFY_MAX_ATTEMPTS) {
                            verify(attempt + 1);
                        }
                        return;
                    }

                    const targetScrollTop = Math.max(measurement.viewportTop + offsetFromViewportTop, 0);
                    // Force the scroll position in case CodeMirror bails out when it thinks the range is already visible.
                    if (Math.abs(measureView.scrollDOM.scrollTop - targetScrollTop) > 1) {
                        measureView.scrollDOM.scrollTop = targetScrollTop;
                    }

                    measureView.dispatch({
                        effects: EditorView.scrollIntoView(selection, { y: 'start' }),
                    });
                    ensureEditorFocus(measureView, focusEditor);

                    if (attempt + 1 < SCROLL_VERIFY_MAX_ATTEMPTS) {
                        verify(attempt + 1);
                    }
                },
            });
        });
    };

    return verify;
}

type SelectionBlockMeasurement = {
    selectionFrom: number;
    blockTopOffset: number;
    viewportTop: number;
};

type SelectionLike = { from: number; to: number } | { selectionFrom: number; selectionTo: number } | null;

function normalizeSelection(selection: SelectionLike): { from: number; to: number } | null {
    if (!selection) {
        return null;
    }

    if ('from' in selection && 'to' in selection) {
        return { from: selection.from, to: selection.to };
    }

    if ('selectionFrom' in selection && 'selectionTo' in selection) {
        return { from: selection.selectionFrom, to: selection.selectionTo };
    }

    return null;
}

function isSameSelection(a: SelectionLike, b: SelectionLike): boolean {
    const normalizedA = normalizeSelection(a);
    const normalizedB = normalizeSelection(b);

    if (!normalizedA || !normalizedB) {
        return false;
    }

    return normalizedA.from === normalizedB.from && normalizedA.to === normalizedB.to;
}

function measureSelectionBlock(
    view: EditorView,
    selection: { from: number; to: number }
): SelectionBlockMeasurement | null {
    const scrollDOM = view.scrollDOM;
    const rect = scrollDOM.getBoundingClientRect();
    if (Number.isNaN(rect.top)) {
        return null;
    }

    const start = view.coordsAtPos(selection.from);
    if (!start) {
        return null;
    }

    const blockTopOffset = start.top - rect.top;
    const viewportTop = scrollDOM.scrollTop;

    return {
        selectionFrom: selection.from,
        blockTopOffset,
        viewportTop,
    };
}

function computeHeadings(state: EditorState): HeadingItem[] {
    return extractHeadings(state.doc.toString());
}

function findActiveHeadingId(headings: HeadingItem[], position: number): string | null {
    if (!headings.length) {
        return null;
    }

    let candidate: HeadingItem | null = null;
    for (const heading of headings) {
        if (heading.from <= position) {
            candidate = heading;
        } else {
            break;
        }
    }

    return candidate?.id ?? headings[0].id;
}

function setEditorSelection(view: EditorView, heading: HeadingItem, focusEditor: boolean): void {
    try {
        const targetSelection = EditorSelection.single(heading.from);

        cancelPendingVerification(view);

        // Move the real selection so the caret and heading panel stay synchronized.
        // Rich Markdown reacts to this by rebuilding image widgets a moment later,
        // which can nudge the scroll position and force us to verify it afterward.
        view.dispatch({
            selection: targetSelection,
            effects: EditorView.scrollIntoView(targetSelection.main, { y: 'start' }),
        });

        ensureEditorFocus(view, focusEditor);

        const runVerification = createScrollVerifier({
            view,
            targetRange: targetSelection.main,
            focusEditor,
        });

        // Trigger visibility checks to catch cases where scrollIntoView bails or later layout
        // shifts (from those widget rebuilds) push the heading away from the viewport edge.
        // Start alignment is more resilient to content changes above the heading since it
        // doesn't depend on relative centering math.
        runVerification(0);
    } catch (error) {
        logger.error('Failed to set editor selection', error);
    }
}

/**
 * Heading navigator content script module for CodeMirror 6.
 *
 * Provides a floating panel for quick heading navigation within Joplin markdown notes.
 * Integrates with the CodeMirror editor to:
 * - Extract headings from the current document using Lezer parser
 * - Display a filterable, keyboard-navigable heading list
 * - Scroll to headings with layout-shift verification for dynamic content
 * - Copy heading links to clipboard via the plugin host
 * - Track active heading based on cursor position
 * - Preserve editor state when panel closes (selection, scroll position)
 *
 * The module registers a CodeMirror plugin that:
 * 1. Listens for document and selection changes
 * 2. Updates heading list and active heading in real-time
 * 3. Handles the `headingNavigator.togglePanel` command from the plugin host
 * 4. Manages panel lifecycle and dimension updates
 *
 * Panel interactions:
 * - Arrow keys/Tab: Navigate between headings with live preview
 * - Enter: Jump to selected heading and close panel
 * - Escape: Close panel and restore original position
 * - Click outside: Close panel and keep current position
 * - Hover copy button: Copy heading link (requires note ID from Joplin)
 *
 * @param context - Content script context for messaging with plugin host
 * @returns CodeMirror content script module with plugin factory
 */
export default function headingNavigator(context: ContentScriptContext): MarkdownEditorContentScriptModule {
    return {
        plugin: (editorControl: CodeMirrorControl) => {
            // Note: Extensions and listeners are scoped to this EditorView instance.
            // When Joplin destroys the editor (note close, plugin disable),
            // all resources are automatically cleaned up. No explicit disposal needed.
            const view = editorControl.editor as EditorView;
            let panel: HeadingPanel | null = null;
            let headings: HeadingItem[] = [];
            let selectedHeadingId: string | null = null;
            let panelDimensions: PanelDimensions = normalizePanelDimensions();
            let initialSelectionRange: { from: number; to: number } | null = null;
            let initialScrollSnapshot: ReturnType<EditorView['scrollSnapshot']> | null = null;
            const noteIdFacet = editorControl.joplinExtensions?.noteIdFacet;

            const resolveNoteId = (): string | null => {
                if (!noteIdFacet) {
                    return null;
                }
                try {
                    const value = view.state.facet(noteIdFacet);
                    if (Array.isArray(value)) {
                        const candidate = value[0];
                        return typeof candidate === 'string' && candidate ? candidate : null;
                    }
                    return typeof value === 'string' && value ? value : null;
                } catch (error) {
                    logger.warn('Failed to resolve active note id from facet', error);
                    return null;
                }
            };

            const sendCopyRequest = async (heading: HeadingItem): Promise<void> => {
                const noteId = resolveNoteId();
                if (!noteId) {
                    logger.warn('Unable to copy heading link because the active note id is unavailable', {
                        headingId: heading.id,
                    });
                    return;
                }

                const message: ContentScriptToPluginMessage = {
                    type: 'copyHeadingLink',
                    noteId,
                    headingText: heading.text,
                    headingAnchor: heading.anchor,
                };

                try {
                    await context.postMessage(message);
                } catch (error) {
                    logger.error('Failed to request heading link copy', error);
                }
            };

            const ensurePanel = (): HeadingPanel => {
                if (!panel) {
                    panel = new HeadingPanel(
                        view,
                        {
                            onPreview: (heading) => {
                                selectedHeadingId = heading.id;
                                setEditorSelection(view, heading, false);
                            },
                            onSelect: (heading) => {
                                selectedHeadingId = heading.id;
                                setEditorSelection(view, heading, true);
                                closePanel(true);
                            },
                            onClose: (reason: PanelCloseReason) => {
                                closePanel(true, reason === 'escape');
                            },
                            onCopy: (heading) => {
                                selectedHeadingId = heading.id;
                                void sendCopyRequest(heading);
                            },
                        },
                        panelDimensions
                    );
                }

                return panel;
            };

            const openPanel = (): void => {
                headings = computeHeadings(view.state);
                selectedHeadingId = findActiveHeadingId(headings, view.state.selection.main.head);
                const selection = view.state.selection.main;
                initialSelectionRange = { from: selection.from, to: selection.to };
                initialScrollSnapshot = view.scrollSnapshot();

                ensurePanel().open(headings, selectedHeadingId);
            };

            const updatePanel = (): void => {
                if (!panel || !panel.isOpen()) {
                    return;
                }

                selectedHeadingId = findActiveHeadingId(headings, view.state.selection.main.head);
                panel.update(headings, selectedHeadingId);
            };

            const closePanel = (focusEditor = false, restoreOriginalPosition = false): void => {
                panel?.destroy();
                panel = null;

                if (restoreOriginalPosition && initialSelectionRange) {
                    cancelPendingVerification(view);

                    try {
                        const selectionToRestore = EditorSelection.range(
                            initialSelectionRange.from,
                            initialSelectionRange.to
                        );

                        view.dispatch({
                            selection: selectionToRestore,
                            effects: initialScrollSnapshot,
                        });
                    } catch (error) {
                        logger.warn('Failed to restore editor selection after closing panel', error);
                    }
                }

                initialSelectionRange = null;
                initialScrollSnapshot = null;

                ensureEditorFocus(view, focusEditor);
            };

            const togglePanel = (dimensions?: PanelDimensions): void => {
                if (dimensions) {
                    panelDimensions = normalizePanelDimensions(dimensions);
                    if (panel) {
                        panel.setOptions(panelDimensions);
                    }
                }

                if (panel?.isOpen()) {
                    closePanel(true);
                } else {
                    openPanel();
                }
            };

            const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
                if (update.docChanged) {
                    headings = computeHeadings(update.state);
                    updatePanel();
                } else if (update.selectionSet) {
                    updatePanel();
                }
            });

            editorControl.addExtension(updateListener);
            editorControl.registerCommand(EDITOR_COMMAND_TOGGLE_PANEL, togglePanel);
        },
    };
}
