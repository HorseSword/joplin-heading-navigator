import { parser } from '@lezer/markdown';
import logger from './logger';
import { HeadingItem } from './types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const uslug = require('@joplin/fork-uslug');

function parseHeadingLevel(nodeName: string): number | null {
    if (nodeName.startsWith('ATXHeading')) {
        const level = Number(nodeName.replace('ATXHeading', ''));
        return Number.isNaN(level) ? null : level;
    }

    if (nodeName.startsWith('SetextHeading')) {
        const level = Number(nodeName.replace('SetextHeading', ''));
        if (level === 1 || level === 2) {
            return level;
        }
    }

    return null;
}

function stripInlineMarkdown(text: string): string {
    return (
        text
            // Inline images: keep alt text if present.
            // Example: "![alt text](image.png)" → "alt text"
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
            // Inline and reference links: keep link label only.
            // Example: "[link text](url)" → "link text"
            .replace(/\[([^\]]*?)\]\s*(\([^)]+\)|\[[^\]]*\])/g, '$1')
            // Bold/italic markers.
            // Example: "**bold**" → "bold", "*italic*" → "italic"
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            // Only remove underscores if they wrap a word with whitespace or start/end boundaries.
            // Use lookahead/lookbehind to preserve surrounding whitespace.
            // Matches: "_emphasized_" → "emphasized"
            // Matches: "start _word_ end" → "start word end"
            // Preserves: "snake_case_var" (no surrounding whitespace)
            // Preserves: "file_name_here" (multiple underscores)
            .replace(/(?<=^|\s)_([^\s_][^_]*[^\s_]|[^\s_])_(?=\s|$)/g, '$1')
            // Inline code.
            // Example: "`code`" → "code"
            .replace(/`([^`]+)`/g, '$1')
            // Escaped characters.
            // Example: "\*" → "*", "\_" → "_"
            .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')
            // Collapse repeated whitespace.
            .replace(/\s+/g, ' ')
            .trim()
    );
}

function normalizeHeadingText(nodeName: string, raw: string): string {
    if (nodeName.startsWith('ATXHeading')) {
        return stripInlineMarkdown(
            raw
                .replace(/^#{1,6}[ \t]*/, '')
                .replace(/[ \t]*#{0,}\s*$/, '')
                .trim()
        );
    }

    if (nodeName.startsWith('SetextHeading')) {
        const lines = raw.split('\n');
        return stripInlineMarkdown(lines[0]?.trim() ?? '');
    }

    return stripInlineMarkdown(raw.trim());
}

function createUniqueAnchor(text: string, fallback: string, counts: Map<string, number>): string {
    const anchorBase = (typeof text === 'string' ? uslug(text) : '') || fallback;
    const previousCount = counts.get(anchorBase);
    if (previousCount === undefined) {
        counts.set(anchorBase, 1);
        return anchorBase;
    }
    counts.set(anchorBase, previousCount + 1);
    return `${anchorBase}-${previousCount + 1}`;
}

function createLineResolver(content: string): (position: number) => number {
    const lineStartIndices: number[] = [0];

    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === '\n') {
            lineStartIndices.push(index + 1);
        }
    }

    return (position: number): number => {
        let low = 0;
        let high = lineStartIndices.length - 1;
        let result = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (lineStartIndices[mid] <= position) {
                result = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return result;
    };
}

/**
 * Extracts heading information from Markdown content using the Lezer parser.
 *
 * Parses both ATX headings (e.g., `# Heading`) and Setext headings (e.g., underlined with `===` or `---`).
 * The text is normalized by stripping inline Markdown formatting (bold, italic, links, images, code)
 * while preserving the readable content.
 *
 * Each heading receives:
 * - A stable ID based on byte position (`heading-{from}`)
 * - A URL-friendly anchor slug (deduplicated if multiple headings have the same text)
 * - Accurate line number and byte range
 *
 * @param content - Raw Markdown document content to parse
 * @returns Array of heading items in document order, or empty array if parsing fails
 *
 * @example
 * ```typescript
 * const markdown = `# Introduction
 * ## **Bold** Section
 * ## Bold Section`;
 *
 * const headings = extractHeadings(markdown);
 * // [
 * //   { id: 'heading-0', text: 'Introduction', level: 1, anchor: 'introduction', line: 0, ... },
 * //   { id: 'heading-16', text: 'Bold Section', level: 2, anchor: 'bold-section', line: 1, ... },
 * //   { id: 'heading-37', text: 'Bold Section', level: 2, anchor: 'bold-section-2', line: 2, ... }
 * // ]
 * ```
 */
export function extractHeadings(content: string): HeadingItem[] {
    try {
        const tree = parser.parse(content);
        const headings: HeadingItem[] = [];
        const resolveLineNumber = createLineResolver(content);
        const anchorCounts = new Map<string, number>();

        tree.iterate({
            enter(node) {
                const level = parseHeadingLevel(node.type.name);
                if (level === null) {
                    return;
                }

                const from = node.from;
                const to = node.to;
                const text = normalizeHeadingText(node.type.name, content.slice(from, to));

                if (!text) {
                    return;
                }

                const anchor = createUniqueAnchor(text, `heading-${from}`, anchorCounts);

                headings.push({
                    id: `heading-${from}`,
                    text,
                    level,
                    from,
                    to,
                    line: resolveLineNumber(from),
                    anchor,
                });
            },
        });

        return headings;
    } catch (error) {
        logger.error('Failed to extract headings', error);
        return [];
    }
}
