/**
 * One Google Identity Services button config for both login pages.
 *
 * The two pages had byte-identical copies of this, including the comment
 * explaining the size choice, which is how they would have drifted apart the next
 * time either was touched.
 *
 * ## The three-way trade
 *
 * Google swaps `renderButton` for its **personalized button** ("Continue as
 * Jason A." plus the signed-in Gmail) for any visitor with a live Google session
 * that already approved this site. There is no flag to turn it off. Per
 * https://developers.google.com/identity/gsi/web/guides/personalized-button it is
 * suppressed only when `type` is `icon`, `size` is `medium` or `small`, `width` is
 * under 200px, or third-party cookies are blocked while FedCM is off.
 *
 * Measured against the live GIS script, rendered control size:
 *
 * | asked              | rendered | label        |
 * |--------------------|----------|--------------|
 * | medium, width 340  | 340x32   | plain        |
 * | large,  width 340  | 340x40   | personalized |
 * | large,  width 199  | 199x40   | plain        |
 * | large,  width 160  | 197x40   | plain        |
 *
 * So no configuration gives a full-width 40px control with the plain label -- any
 * two of the three, never all three. Both other corners were tried on the login
 * screen and rejected: `medium` at full width is a 32px control under a 44px
 * submit button and reads as an afterthought, and `large` at 199px is visibly
 * inset from the full-width submit button above it.
 *
 * All three corners were tried on the login screen and each was rejected: `medium`
 * at full width is a 32px control under a 44px submit button; `large` at 199px is
 * visibly inset from that submit button; `large` at full width shows the visitor's
 * name and email on the login screen.
 *
 * So this does not pick a corner. It renders `medium` -- plain label, any width --
 * narrow, and scales it up to the row, which is the only way to get all three.
 * See `renderGoogleIdentityButton`.
 */

/**
 * GIS honours `width` up to 400, and the widest login card leaves exactly 400 of
 * inner width (`max-w-md` minus CardContent's `px-6`).
 */
const MAX_WIDTH = 400
/** Below this the control stops shrinking anyway (measured floor ~197px). */
const MIN_WIDTH = 240

/** `size: 'medium'` renders a 32px-tall control. */
const CONTROL_HEIGHT = 32
/** Match CONTROL_HEIGHT exactly so scale = 1 — no CSS scaling, native font size preserved. */
const TARGET_HEIGHT = 32
const MAX_SCALE = TARGET_HEIGHT / CONTROL_HEIGHT

/** Options shared by both login pages; `width` is filled in per container. */
const BASE_OPTIONS = {
  type: 'standard',
  theme: 'outline',
  // Medium keeps the plain "Continue with Google" label at any width. It is 32px
  // tall, which the caller scales up; `large` would be 40px but personalized.
  size: 'medium',
  text: 'continue_with',
  // Pill, as the login screens have shipped it. The submit buttons are
  // `rounded-[10px]`, so `rectangular` would echo them more closely -- a
  // deliberate open question rather than an oversight.
  shape: 'pill',
  logo_alignment: 'left',
} as const

/**
 * Renders a plain, full-width, 44px-tall button.
 *
 * `renderButton` cannot do that directly: 40px is its ceiling, and every height
 * above `medium`'s 32px brings the personalized chip. So the control is rendered
 * narrow at `medium` and scaled up to fill the row -- uniformly, so Google's
 * proportions and branding are preserved, and the scale is chosen so the drawn
 * size lands exactly on the container.
 *
 * `target` must be shrink-to-fit (no width class) inside a centred flex row: its
 * layout box then equals the control, and scaling about its centre grows it to the
 * row's width without overflowing.
 *
 * On a narrow card, where the width needed at full scale would fall under
 * `MIN_WIDTH`, the scale drops instead so the button still spans the row -- a
 * shorter button rather than one that overflows it.
 */
export function renderGoogleIdentityButton(
  target: HTMLElement,
  gis: { renderButton: (element: HTMLElement, options: Record<string, unknown>) => void },
): void {
  const row = target.parentElement?.clientWidth || target.clientWidth || MAX_WIDTH
  const available = Math.floor(row)
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(available / MAX_SCALE)))
  // Never magnify past the 44px target, and never past what the row can hold.
  const scale = Math.max(1, Math.min(MAX_SCALE, available / width))

  target.innerHTML = ''
  target.style.transformOrigin = 'center'
  target.style.transform = `scale(${scale})`
  gis.renderButton(target, { ...BASE_OPTIONS, width })
}
