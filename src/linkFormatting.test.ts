import { escapeLinkText, formatHeadingLink } from './linkFormatting';

describe('escapeLinkText', () => {
    it('escapes square brackets', () => {
        expect(escapeLinkText('Hello [World]')).toBe('Hello \\[World\\]');
        expect(escapeLinkText('[Complex]')).toBe('\\[Complex\\]');
    });

    it('escapes backslashes', () => {
        expect(escapeLinkText('Path\\to\\file')).toBe('Path\\\\to\\\\file');
    });

    it('escapes both brackets and backslashes', () => {
        expect(escapeLinkText('[Test] \\Example\\')).toBe('\\[Test\\] \\\\Example\\\\');
    });

    it('returns original text when no escaping needed', () => {
        expect(escapeLinkText('Simple text')).toBe('Simple text');
    });

    it('handles empty string', () => {
        expect(escapeLinkText('')).toBe('');
    });
});

describe('formatHeadingLink', () => {
    it('formats heading link with note title', () => {
        const result = formatHeadingLink('Usage', 'Guide', 'abc123', 'usage');
        expect(result).toBe('[Usage @ Guide](:/abc123#usage)');
    });

    it('escapes special characters in heading and note title', () => {
        const result = formatHeadingLink('[API]', '[Docs]', 'abc', 'api');
        expect(result).toBe('[\\[API\\] @ \\[Docs\\]](:/abc#api)');
    });

    it('handles headings with backslashes', () => {
        const result = formatHeadingLink('Path\\to\\file', 'Note\\Title', 'id123', 'path-to-file');
        expect(result).toBe('[Path\\\\to\\\\file @ Note\\\\Title](:/id123#path-to-file)');
    });

    it('formats link with special anchor characters', () => {
        const result = formatHeadingLink('Hello World', 'My Note', 'xyz', 'hello-world-2');
        expect(result).toBe('[Hello World @ My Note](:/xyz#hello-world-2)');
    });
});
