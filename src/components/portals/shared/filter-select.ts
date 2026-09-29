/**
 * A native filter <select> dressed like the search Input beside it: same border,
 * shadow and focus ring. Bare selects showed the browser's heavy black focus
 * outline instead. It fills its column, so a toolbar's filters line up evenly.
 */
export const FILTER_SELECT_CLASS =
  'h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'
