/**
 * Markdown heading extraction using the Lezer parser.
 *
 * Parses ATX (`# Heading`) and Setext (underlined) headings from markdown documents,
 * strips inline formatting (bold, italic, links, code), and generates stable IDs and
 * GitHub-compatible anchor slugs.
 *
 * Implementation details:
 * - Uses Lezer AST parser (not regex) for reliable heading detection
 * - Stable IDs based on byte position (`heading-{from}`)
 * - Anchor deduplication (e.g., "intro" → "intro-2" → "intro-3")
 * - CodeMirror Text class for efficient position → line number conversion
 * - Preserves snake_case in headings (doesn't break on underscores)
 *
 * @see stripInlineMarkdown - Regex patterns for removing markdown formatting
 */

import { parser } from '@lezer/markdown';
import { Text } from '@codemirror/state';
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

/**
 * Extracts all headings from markdown content with normalized text and metadata.
 *
 * @param content - Raw markdown document to parse
 * @returns Array of headings in document order, or empty array if parsing fails
 *
 * @example
 * ```typescript
 * const headings = extractHeadings('# Introduction\n## **Bold** Section\n## Bold Section');
 * // [
 * //   { id: 'heading-0', text: 'Introduction', level: 1, anchor: 'introduction', ... },
 * //   { id: 'heading-16', text: 'Bold Section', level: 2, anchor: 'bold-section', ... },
 * //   { id: 'heading-37', text: 'Bold Section', level: 2, anchor: 'bold-section-2', ... }
 * // ]
 * ```
 */
export function extractHeadings(content: string): HeadingItem[] {
    try {
        const tree = parser.parse(content);
        const doc = Text.of(content.split('\n'));
        const headings: HeadingItem[] = [];
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
                    line: doc.lineAt(from).number - 1,
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
