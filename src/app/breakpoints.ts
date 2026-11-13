/**
 * The few sizes at which the interface changes arrangement, shared by script and (by hand) by the
 * stylesheets that mention the same numbers.
 */

/** Narrower than this is a phone: bottom sheets instead of popovers, and the compact collar. */
export const NARROW_PX = 720;

/** No taller than this is a phone on its side: there is no height for a popover either. */
export const SHORT_PX = 500;

/** Matches when overlays (place picker, More menu) should be bottom sheets rather than popovers. */
export const SHEET_QUERY = `(max-width: ${NARROW_PX - 1}px), (max-height: ${SHORT_PX}px)`;
