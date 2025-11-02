export function escapeLinkText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
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
