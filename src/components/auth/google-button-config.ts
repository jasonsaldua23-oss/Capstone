/** Render the interactive Google control shared by the web login pages. */
export function renderGoogleIdentityButton(
  target: HTMLElement,
  gis: { renderButton: (element: HTMLElement, options: Record<string, unknown>) => void },
): void {
  const available = target.parentElement?.clientWidth || target.clientWidth || 400
  // Medium suppresses Google's account preview. Scale uniformly to a 40px
  // control so the plain label stays prominent without stretching its artwork.
  const scale = 40 / 32
  const width = Math.min(400, Math.floor(available / scale))

  target.replaceChildren()
  // Keep the actual control visible and interactive; no transparent click layer.
  target.style.transform = 'none'
  target.className = 'flex h-11 w-full items-center justify-center'
  const control = document.createElement('div')
  control.style.transform = `scale(${scale})`
  control.style.transformOrigin = 'center'
  target.append(control)
  gis.renderButton(control, {
    type: 'standard',
    theme: 'outline',
    size: 'medium',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    width,
  })
}
