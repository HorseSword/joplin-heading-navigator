/**
 * Message protocol for content script → plugin host communication.
 *
 * The content script runs in Joplin's CodeMirror editor context and cannot directly
 * access Joplin APIs (clipboard, data store, etc.). Messages defined here are sent
 * via the postMessage bridge to the plugin host, which handles the actual operations.
 *
 * @see headingNavigator.ts - Content script that sends these messages
 * @see index.ts - Plugin host that receives and processes messages
 */

export interface CopyHeadingLinkMessage {
    type: 'copyHeadingLink';
    noteId: string;
    headingText: string;
    headingAnchor: string;
}

export type ContentScriptToPluginMessage = CopyHeadingLinkMessage;
