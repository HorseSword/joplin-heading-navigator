import type { PanelDimensions } from './types';
import { DEFAULT_PANEL_DIMENSIONS } from './types';

export const MIN_PANEL_WIDTH = 240;
export const MAX_PANEL_WIDTH = 640;
export const MIN_PANEL_HEIGHT_PERCENTAGE = 40;
export const MAX_PANEL_HEIGHT_PERCENTAGE = 90;

export const DEFAULT_PANEL_WIDTH = DEFAULT_PANEL_DIMENSIONS.width;
export const DEFAULT_PANEL_HEIGHT_PERCENTAGE = Math.round(DEFAULT_PANEL_DIMENSIONS.maxHeightRatio * 100);

export const MIN_PANEL_HEIGHT_RATIO = MIN_PANEL_HEIGHT_PERCENTAGE / 100;
export const MAX_PANEL_HEIGHT_RATIO = MAX_PANEL_HEIGHT_PERCENTAGE / 100;

export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

export function normalizePanelWidth(raw: unknown): { value: number; changed: boolean } {
    const fallback = DEFAULT_PANEL_WIDTH;
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
        return { value: fallback, changed: true };
    }
    const clamped = clamp(Math.round(raw), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    return { value: clamped, changed: clamped !== raw };
}

export function normalizePanelHeightPercentage(raw: unknown): { value: number; changed: boolean } {
    const fallback = DEFAULT_PANEL_HEIGHT_PERCENTAGE;
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
        return { value: fallback, changed: true };
    }
    const clamped = clamp(Math.round(raw), MIN_PANEL_HEIGHT_PERCENTAGE, MAX_PANEL_HEIGHT_PERCENTAGE);
    return { value: clamped, changed: clamped !== raw };
}

export function normalizePanelHeightRatio(raw: unknown): { value: number; changed: boolean } {
    const fallback = DEFAULT_PANEL_DIMENSIONS.maxHeightRatio;
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
        return { value: fallback, changed: true };
    }
    const clamped = clamp(raw, MIN_PANEL_HEIGHT_RATIO, MAX_PANEL_HEIGHT_RATIO);
    return { value: clamped, changed: clamped !== raw };
}

/**
 * Normalizes and validates panel dimension settings.
 *
 * Ensures width and height ratio values are within acceptable ranges:
 * - Width: 240-640 pixels (rounded to integer)
 * - Height ratio: 0.40-0.90 (40%-90% of editor viewport)
 *
 * Invalid or missing values are replaced with defaults (320px width, 0.75 ratio).
 * Used both when loading user settings and when receiving dimension updates from the plugin host.
 *
 * @param dimensions - Partial dimension configuration (may contain invalid or missing values)
 * @returns Validated and normalized panel dimensions with all required fields
 *
 */
export function normalizePanelDimensions(dimensions?: Partial<PanelDimensions>): PanelDimensions {
    const widthResult = normalizePanelWidth(dimensions?.width);
    const heightResult = normalizePanelHeightRatio(dimensions?.maxHeightRatio);
    return {
        width: widthResult.value,
        maxHeightRatio: heightResult.value,
    };
}
