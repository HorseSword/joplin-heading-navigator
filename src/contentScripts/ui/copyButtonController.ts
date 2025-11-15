/**
 * Manages copy button creation, animations, and cleanup for heading items.
 *
 * Handles the lifecycle of copy buttons including:
 * - DOM creation with SVG icons
 * - Visual feedback animations
 * - Timer cleanup to prevent memory leaks
 */
export class CopyButtonController {
    private readonly copyAnimationTimers = new WeakMap<HTMLButtonElement, number>();

    /**
     * Creates a copy button element for a heading item.
     *
     * The button displays a link icon. Click handling is managed via event delegation
     * in the parent panel for better performance with large lists.
     *
     * @returns The configured button element ready to be added to the DOM
     */
    public createCopyButton(): HTMLButtonElement {
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'heading-navigator-copy-button';
        copyButton.title = 'Copy heading link';
        copyButton.setAttribute('aria-label', 'Copy heading link');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');

        const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path1.setAttribute('d', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71');

        const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path2.setAttribute('d', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71');

        svg.appendChild(path1);
        svg.appendChild(path2);
        copyButton.appendChild(svg);

        return copyButton;
    }

    /**
     * Shows visual feedback on a copy button by adding a CSS class temporarily.
     *
     * The feedback lasts 600ms and automatically cleans up. If called again while
     * feedback is showing, the previous timer is cancelled and restarted.
     *
     * @param button - The button element to show feedback on
     */
    public showCopyFeedback(button: HTMLButtonElement): void {
        const existingTimer = this.copyAnimationTimers.get(button);
        if (typeof existingTimer === 'number') {
            window.clearTimeout(existingTimer);
        }

        button.classList.add('is-copied');

        const timerId = window.setTimeout(() => {
            button.classList.remove('is-copied');
            this.copyAnimationTimers.delete(button);
        }, 600);

        this.copyAnimationTimers.set(button, timerId);
    }

    /**
     * Clears the animation timer for a specific button.
     *
     * Useful when removing buttons from the DOM to prevent timer callbacks
     * from running after removal.
     *
     * @param button - The button to clear the timer for
     */
    public clearButton(button: HTMLButtonElement): void {
        const timerId = this.copyAnimationTimers.get(button);
        if (typeof timerId === 'number') {
            window.clearTimeout(timerId);
            this.copyAnimationTimers.delete(button);
        }
    }

    /**
     * Clears all copy animation timers.
     *
     * Must be called before destroying the panel to prevent timer callbacks
     * from running after DOM removal.
     *
     * @param container - The container element to search for buttons within
     */
    public destroy(container: HTMLElement): void {
        container.querySelectorAll<HTMLButtonElement>('.heading-navigator-copy-button').forEach((button) => {
            this.clearButton(button);
        });
    }
}
