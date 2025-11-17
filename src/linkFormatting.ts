/**
 * Utilities for formatting Joplin note links to headings.
 *
 * Creates markdown links in Joplin's internal link format: `[label](:/noteId#anchor)`
 * Used by the copy-to-clipboard feature to generate shareable heading links.
 *
 * @example
 * ```typescript
 * formatHeadingLink('Introduction', 'My Note', 'abc123', 'introduction')
 * // Returns: "[Introduction @ My Note](:/abc123#introduction)"
 * ```
 */

export function escapeLinkText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/&/g, '\\&')
        .replace(/</g, '\\<')
        .replace(/>/g, '\\>')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

export function formatHeadingLink(
    headingText: string,
    noteTitle: string,
    noteId: string,
    headingAnchor: string
): string {
    const label = `${escapeLinkText(headingText)} @ ${escapeLinkText(noteTitle)}`;
    const target = `:/${noteId}#${headingAnchor}`;
    return `[${label}](${target})`;
}
