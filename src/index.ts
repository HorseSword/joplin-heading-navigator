import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { CODEMIRROR_CONTENT_SCRIPT_ID, COMMAND_GO_TO_HEADING, EDITOR_COMMAND_TOGGLE_PANEL } from './constants';
import logger from './logger';
import { loadPanelDimensions, registerPanelSettings } from './settings';
import type { ContentScriptToPluginMessage, CopyHeadingLinkMessage } from './messages';

function escapeLinkText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

async function handleCopyHeadingLink(message: CopyHeadingLinkMessage): Promise<void> {
    const { noteId, headingText, headingAnchor } = message;

    try {
        const note = await joplin.data.get(['notes', noteId], { fields: ['id', 'title'] });

        if (!note || typeof note.id !== 'string') {
            logger.warn('Unable to copy heading link because note could not be resolved', { noteId, headingAnchor });
            return;
        }

        const noteTitle = typeof note.title === 'string' && note.title ? note.title : 'Untitled';
        const label = `${escapeLinkText(headingText)} @ ${escapeLinkText(noteTitle)}`;
        const target = `:/${noteId}#${headingAnchor}`;
        const markdown = `[${label}](${target})`;

        await joplin.clipboard.writeText(markdown);
        logger.info('Copied heading link to clipboard', { noteId, headingAnchor });
    } catch (error) {
        logger.error('Failed to copy heading link to clipboard', error);
    }
}

async function registerContentScripts(): Promise<void> {
    await joplin.contentScripts.register(
        ContentScriptType.CodeMirrorPlugin,
        CODEMIRROR_CONTENT_SCRIPT_ID,
        './contentScripts/headingNavigator.js'
    );

    await joplin.contentScripts.onMessage(
        CODEMIRROR_CONTENT_SCRIPT_ID,
        async (message: ContentScriptToPluginMessage): Promise<void> => {
            if (!message || typeof message !== 'object') {
                return;
            }

            switch (message.type) {
                case 'copyHeadingLink':
                    await handleCopyHeadingLink(message);
                    return;
                default:
                    logger.warn('Received unsupported message from content script', message);
            }
        }
    );
}

async function registerCommands(): Promise<void> {
    await joplin.commands.register({
        name: COMMAND_GO_TO_HEADING,
        label: 'Go to Heading',
        iconName: 'fas fa-heading',
        execute: async () => {
            logger.info('Go to Heading command triggered');
            const panelDimensions = await loadPanelDimensions();
            await joplin.commands.execute('editor.execCommand', {
                name: EDITOR_COMMAND_TOGGLE_PANEL,
                args: [panelDimensions],
            });
        },
    });
}

async function registerMenuItems(): Promise<void> {
    await joplin.views.menuItems.create('headingNavigatorMenuItem', COMMAND_GO_TO_HEADING, MenuItemLocation.Edit);
}

async function registerToolbarButton(): Promise<void> {
    await joplin.views.toolbarButtons.create(
        'headingNavigatorToolbarButton',
        COMMAND_GO_TO_HEADING,
        ToolbarButtonLocation.EditorToolbar
    );
}

joplin.plugins.register({
    onStart: async () => {
        logger.info('Heading Navigator plugin starting');
        await registerPanelSettings();
        await registerContentScripts();
        await registerCommands();
        await registerMenuItems();
        await registerToolbarButton();
    },
});
