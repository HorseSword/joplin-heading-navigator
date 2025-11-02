export interface CopyHeadingLinkMessage {
    type: 'copyHeadingLink';
    noteId: string;
    headingText: string;
    headingAnchor: string;
}

export type ContentScriptToPluginMessage = CopyHeadingLinkMessage;
