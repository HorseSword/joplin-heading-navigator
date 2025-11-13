import { EditorView } from '@codemirror/view';
import type { HeadingItem, PanelDimensions } from '../../types';
import { createPanelCss, createPanelTheme } from '../theme/panelTheme';
import { CopyButtonController } from './copyButtonController';

const PANEL_STYLE_ID = 'heading-navigator-styles';
const INDENT_BASE_PX = 12;
const INDENT_PER_LEVEL_PX = 12;

export type PanelCloseReason = 'escape' | 'blur';

export interface PanelCallbacks {
    onPreview: (heading: HeadingItem) => void;
    onSelect: (heading: HeadingItem) => void;
    onClose: (reason: PanelCloseReason) => void;
    onCopy: (heading: HeadingItem) => void;
}

/**
 * Floating panel UI for heading navigation with filtering, keyboard navigation, and copy functionality.
 *
 * Manages a filterable list of document headings with:
 * - Real-time search filtering
 * - Keyboard navigation (arrow keys, tab, enter, escape)
 * - Mouse selection and hover interactions
 * - Incremental DOM rendering for performance
 * - Theme-aware styling derived from editor
 * - Copy-to-clipboard for individual headings
 *
 * @example
 * ```typescript
 * const panel = new HeadingPanel(editorView, {
 *   onPreview: (heading) => scrollToHeading(heading),
 *   onSelect: (heading) => { scrollToHeading(heading); panel.destroy(); },
 *   onClose: (reason) => { restoreState(); panel.destroy(); },
 *   onCopy: (heading) => copyHeadingLink(heading)
 * }, dimensions);
 *
 * panel.open(headings, currentHeadingId);
 * ```
 */
export class HeadingPanel {
    private readonly view: EditorView;

    private readonly container: HTMLDivElement;

    private readonly input: HTMLInputElement;

    private readonly list: HTMLUListElement;

    private headings: HeadingItem[] = [];

    private filtered: HeadingItem[] = [];

    private selectedHeadingId: string | null = null;

    private options: PanelDimensions;

    private lastPreviewedId: string | null = null;

    private previewDebounceTimer: number | null = null;

    private readonly onPreview: (heading: HeadingItem) => void;

    private readonly onSelect: (heading: HeadingItem) => void;

    private readonly onClose: (reason: PanelCloseReason) => void;

    private readonly onCopy: (heading: HeadingItem) => void;

    private readonly handleInputListener: () => void;

    private readonly handleKeyDownListener: (event: KeyboardEvent) => void;

    private readonly handleListClickListener: (event: MouseEvent) => void;

    private readonly handleDocumentMouseDownListener: (event: MouseEvent) => void;

    private readonly copyButtonController = new CopyButtonController();

    public constructor(view: EditorView, callbacks: PanelCallbacks, options: PanelDimensions) {
        this.view = view;
        this.onPreview = callbacks.onPreview;
        this.onSelect = callbacks.onSelect;
        this.onClose = callbacks.onClose;
        this.onCopy = callbacks.onCopy;
        this.options = options;

        this.container = document.createElement('div');
        this.container.className = 'heading-navigator-panel';

        this.input = document.createElement('input');
        this.input.type = 'search';
        this.input.placeholder = 'Filter headings';
        this.input.className = 'heading-navigator-input';
        this.container.appendChild(this.input);

        this.list = document.createElement('ul');
        this.list.className = 'heading-navigator-list';
        this.container.appendChild(this.list);

        this.handleInputListener = () => {
            this.applyFilter(this.input.value);
            this.notifyPreview();
        };

        this.handleKeyDownListener = (event: KeyboardEvent) => {
            this.handleKeyDown(event);
        };

        this.handleListClickListener = (event: MouseEvent) => {
            this.handleListClick(event);
        };

        this.handleDocumentMouseDownListener = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }

            if (this.container.contains(target)) {
                return;
            }

            this.onClose('blur');
        };

        this.input.addEventListener('input', this.handleInputListener);
        this.input.addEventListener('keydown', this.handleKeyDownListener);
        this.list.addEventListener('click', this.handleListClickListener);
        this.ownerDocument().addEventListener('mousedown', this.handleDocumentMouseDownListener, true);
    }

    /**
     * Opens the panel and displays the provided headings.
     *
     * Mounts the panel to the DOM, clears any previous filter state, and focuses the search input.
     * The panel selects the heading matching `selectedId` if provided, otherwise selects the first heading.
     *
     * @param headings - Array of headings to display
     * @param selectedId - ID of the heading to initially select (null for first heading)
     */
    public open(headings: HeadingItem[], selectedId: string | null): void {
        this.mount();
        this.input.value = '';
        this.selectedHeadingId = selectedId;
        this.lastPreviewedId = null;
        this.setHeadings(headings, '', true);
        requestAnimationFrame(() => {
            if (this.isOpen()) {
                this.input.focus();
            }
        });
    }

    /**
     * Updates the panel with new heading data while preserving UI state.
     *
     * Used when the document content changes while the panel is open. Preserves the current
     * filter text by default, and uses incremental rendering to update only changed headings.
     *
     * @param headings - Updated array of headings
     * @param selectedId - ID of the heading that should be selected (null to preserve current selection)
     * @param preserveFilter - Whether to keep the current filter text (default: true)
     */
    public update(headings: HeadingItem[], selectedId: string | null, preserveFilter = true): void {
        const filterText = preserveFilter ? this.input.value : '';
        if (!preserveFilter) {
            this.input.value = '';
        }
        this.selectedHeadingId = selectedId ?? this.selectedHeadingId;
        this.setHeadings(headings, filterText, false);
    }

    /**
     * Removes the panel from the DOM and cleans up event listeners and timers.
     *
     * Must be called when the panel is no longer needed to prevent memory leaks.
     * Safe to call multiple times.
     */
    public destroy(): void {
        this.input.removeEventListener('input', this.handleInputListener);
        this.input.removeEventListener('keydown', this.handleKeyDownListener);
        this.list.removeEventListener('click', this.handleListClickListener);
        this.ownerDocument().removeEventListener('mousedown', this.handleDocumentMouseDownListener, true);
        if (this.previewDebounceTimer !== null) {
            clearTimeout(this.previewDebounceTimer);
            this.previewDebounceTimer = null;
        }
        this.copyButtonController.destroy(this.list);
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }

    /**
     * Checks whether the panel is currently mounted in the DOM.
     *
     * @returns true if the panel is visible, false otherwise
     */
    public isOpen(): boolean {
        return Boolean(this.container.parentElement);
    }

    /**
     * Updates the panel's dimensions and regenerates styles if needed.
     *
     * Triggers style regeneration only if dimensions actually changed, avoiding unnecessary
     * CSS recalculation.
     *
     * @param options - New panel dimension configuration
     */
    public setOptions(options: PanelDimensions): void {
        this.options = options;
        ensurePanelStyles(this.view, this.options);
    }

    private ownerDocument(): Document {
        return this.view.dom.ownerDocument ?? document;
    }

    private mount(): void {
        ensurePanelStyles(this.view, this.options);

        if (!this.container.parentElement) {
            const scrollRoot = this.view.scrollDOM.parentElement;
            const fallbackRoot = this.view.dom.parentElement ?? this.view.dom;
            (scrollRoot ?? fallbackRoot).appendChild(this.container);
        }
    }

    private setHeadings(headings: HeadingItem[], filterText = '', emitPreview = true): void {
        this.headings = headings;
        this.applyFilter(filterText);
        if (emitPreview) {
            this.notifyPreview();
        } else {
            this.updatePreviewMarker();
        }
    }

    private applyFilter(filterText: string): void {
        const normalized = filterText.trim().toLowerCase();
        if (!normalized) {
            this.filtered = [...this.headings];
        } else {
            this.filtered = this.headings.filter((heading) => heading.text.toLowerCase().includes(normalized));
        }

        if (this.filtered.length === 0) {
            this.selectedHeadingId = null;
        } else if (this.selectedHeadingId) {
            const match = this.filtered.find((heading) => heading.id === this.selectedHeadingId);
            if (!match) {
                this.selectedHeadingId = this.filtered[0].id;
            }
        } else {
            this.selectedHeadingId = this.filtered[0].id;
        }

        this.render();
    }

    private notifyPreview(): void {
        if (this.previewDebounceTimer !== null) {
            clearTimeout(this.previewDebounceTimer);
            this.previewDebounceTimer = null;
        }

        if (!this.selectedHeadingId) {
            this.lastPreviewedId = null;
            return;
        }

        if (this.selectedHeadingId === this.lastPreviewedId) {
            return;
        }

        const heading = this.headings.find((item) => item.id === this.selectedHeadingId);
        if (!heading) {
            this.lastPreviewedId = null;
            return;
        }

        const targetId = heading.id;
        this.previewDebounceTimer = window.setTimeout(() => {
            this.previewDebounceTimer = null;

            if (this.selectedHeadingId !== targetId) {
                return;
            }

            const currentHeading = this.headings.find((item) => item.id === targetId);
            if (!currentHeading) {
                this.lastPreviewedId = null;
                return;
            }

            this.lastPreviewedId = currentHeading.id;
            this.onPreview(currentHeading);
        }, 30);
    }

    private updatePreviewMarker(): void {
        if (!this.selectedHeadingId) {
            this.lastPreviewedId = null;
            return;
        }

        const heading = this.headings.find((item) => item.id === this.selectedHeadingId);
        this.lastPreviewedId = heading?.id ?? null;
    }

    private handleKeyDown(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.moveSelection(1);
                break;
            case 'Tab':
                event.preventDefault();
                this.moveSelection(event.shiftKey ? -1 : 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.moveSelection(-1);
                break;
            case 'Enter':
                event.preventDefault();
                this.confirmSelection();
                break;
            case 'Escape':
                event.preventDefault();
                this.onClose('escape');
                break;
            default:
                break;
        }
    }

    private moveSelection(delta: number): void {
        if (!this.filtered.length) {
            this.selectedHeadingId = null;
            this.render();
            return;
        }

        const currentIndex = this.filtered.findIndex((heading) => heading.id === this.selectedHeadingId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + delta + this.filtered.length) % this.filtered.length : 0;
        this.selectedHeadingId = this.filtered[nextIndex].id;
        this.updateSelection();
        this.scrollActiveItemIntoView();
        this.notifyPreview();
    }

    private confirmSelection(): void {
        if (!this.selectedHeadingId) {
            return;
        }

        const heading = this.headings.find((item) => item.id === this.selectedHeadingId);
        if (heading) {
            this.onSelect(heading);
        }
    }

    private handleListClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.heading-navigator-copy-button')) {
            return;
        }
        const itemElement = target?.closest<HTMLLIElement>('.heading-navigator-item');
        if (!itemElement) {
            return;
        }

        const headingId = itemElement.dataset.headingId;
        if (!headingId) {
            return;
        }

        const heading = this.headings.find((item) => item.id === headingId);
        if (heading) {
            this.selectedHeadingId = heading.id;
            this.confirmSelection();
        }
    }

    private render(): void {
        if (!this.filtered.length) {
            this.renderEmptyState();
            return;
        }

        this.reconcileItems();
        this.scrollActiveItemIntoView();
    }

    /**
     * Renders the empty state when no headings match the current filter.
     *
     * Clears the list and displays a "No headings found" message.
     */
    private renderEmptyState(): void {
        this.list.innerHTML = '';
        const empty = document.createElement('li');
        empty.className = 'heading-navigator-empty';
        empty.textContent = 'No headings found';
        this.list.appendChild(empty);
    }

    /**
     * Performs efficient keyed DOM reconciliation for heading items.
     *
     * Updates the DOM to match the filtered headings list by:
     * - Removing empty state node if present
     * - Reusing existing DOM nodes where possible
     * - Creating new nodes for new headings
     * - Updating changed content
     * - Maintaining correct order
     * - Updating selection state
     */
    private reconcileItems(): void {
        // Remove empty state node if it exists
        const emptyNode = this.list.querySelector('.heading-navigator-empty');
        if (emptyNode) {
            emptyNode.remove();
        }

        // Build a map of existing items
        const existingItems = new Map<string, HTMLLIElement>();
        this.list.querySelectorAll<HTMLLIElement>('.heading-navigator-item').forEach((item) => {
            const id = item.dataset.headingId;
            if (id) {
                existingItems.set(id, item);
            }
        });

        // Remove items not in filtered list
        const filteredIds = new Set(this.filtered.map((h) => h.id));
        existingItems.forEach((item, id) => {
            if (!filteredIds.has(id)) {
                item.remove();
                existingItems.delete(id);
            }
        });

        // Update or create items in correct order
        this.filtered.forEach((heading, index) => {
            let item = existingItems.get(heading.id);

            if (!item) {
                // Create new item
                item = this.createHeadingItem(heading);
                existingItems.set(heading.id, item);
            } else {
                // Update existing item if needed
                this.updateHeadingItem(item, heading);
            }

            // Ensure correct order
            const currentChild = this.list.children[index];
            if (currentChild !== item) {
                this.list.insertBefore(item, currentChild || null);
            }

            // Update selection state
            if (heading.id === this.selectedHeadingId) {
                item.classList.add('is-selected');
            } else {
                item.classList.remove('is-selected');
            }
        });
    }

    private createHeadingItem(heading: HeadingItem): HTMLLIElement {
        const item = document.createElement('li');
        item.className = 'heading-navigator-item';
        item.dataset.headingId = heading.id;
        item.style.paddingLeft = `${INDENT_BASE_PX + (heading.level - 1) * INDENT_PER_LEVEL_PX}px`;

        const level = document.createElement('span');
        level.className = 'heading-navigator-item-level';
        level.textContent = `H${heading.level} · line ${heading.line + 1}`;

        const text = document.createElement('span');
        text.className = 'heading-navigator-item-text';
        text.textContent = heading.text;

        // Resolve current heading at click time to avoid stale closure
        const copyButton = this.copyButtonController.createCopyButton(
            heading,
            (h) => {
                const currentHeading = this.headings.find((item) => item.id === h.id);
                if (currentHeading) {
                    this.onCopy(currentHeading);
                }
            },
            () => {
                this.input.focus();
            }
        );

        item.appendChild(level);
        item.appendChild(text);
        item.appendChild(copyButton);

        return item;
    }

    private updateHeadingItem(item: HTMLLIElement, heading: HeadingItem): void {
        // Update padding if level changed
        const newPadding = `${INDENT_BASE_PX + (heading.level - 1) * INDENT_PER_LEVEL_PX}px`;
        if (item.style.paddingLeft !== newPadding) {
            item.style.paddingLeft = newPadding;
        }

        // Update level text
        const levelSpan = item.querySelector('.heading-navigator-item-level');
        const newLevelText = `H${heading.level} · line ${heading.line + 1}`;
        if (levelSpan && levelSpan.textContent !== newLevelText) {
            levelSpan.textContent = newLevelText;
        }

        // Update heading text
        const textSpan = item.querySelector('.heading-navigator-item-text');
        if (textSpan && textSpan.textContent !== heading.text) {
            textSpan.textContent = heading.text;
        }
    }

    private updateSelection(): void {
        const items = this.list.querySelectorAll<HTMLLIElement>('.heading-navigator-item');
        items.forEach((item) => {
            if (item.dataset.headingId === this.selectedHeadingId) {
                item.classList.add('is-selected');
            } else {
                item.classList.remove('is-selected');
            }
        });
    }

    private scrollActiveItemIntoView(): void {
        const activeItem = this.list.querySelector<HTMLLIElement>('.heading-navigator-item.is-selected');
        activeItem?.scrollIntoView({ block: 'nearest' });
    }
}

function ensurePanelStyles(view: EditorView, options: PanelDimensions): void {
    const doc = view.dom.ownerDocument ?? document;
    const theme = createPanelTheme(view);
    const signature = [
        theme.background,
        theme.foreground,
        theme.border,
        theme.divider,
        theme.muted,
        theme.selectedBackground,
        theme.selectedForeground,
        options.width.toString(),
        options.maxHeightRatio.toFixed(4),
    ].join('|');

    let style = doc.getElementById(PANEL_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = doc.createElement('style');
        style.id = PANEL_STYLE_ID;
        (doc.head ?? doc.body).appendChild(style);
    }

    if (style.getAttribute('data-theme-signature') === signature) {
        return;
    }

    style.setAttribute('data-theme-signature', signature);
    style.textContent = createPanelCss(theme, options);
}
