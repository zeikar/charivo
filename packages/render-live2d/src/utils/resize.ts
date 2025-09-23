export type ResizeTeardown = () => void

export function setupResponsiveResize(
  canvas: HTMLCanvasElement,
  resize: () => void
): ResizeTeardown {
  let resizeObserver: ResizeObserver | undefined
  let mutationObserver: MutationObserver | undefined
  let windowResizeHandler: (() => void) | undefined

  // Initial run
  setTimeout(resize, 0)

  try {
    resizeObserver = new ResizeObserver(() => resize())
    const parentEl = canvas.parentElement
    if (parentEl) {
      resizeObserver.observe(parentEl)
    } else if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        if (canvas.parentElement) {
          resizeObserver?.observe(canvas.parentElement)
          resize()
          mutationObserver?.disconnect()
          mutationObserver = undefined
        }
      })
      mutationObserver.observe(document.body, { childList: true, subtree: true })
    }
  } catch {
    windowResizeHandler = resize
    window.addEventListener('resize', windowResizeHandler)
  }

  return () => {
    try {
      if (resizeObserver && canvas.parentElement) {
        resizeObserver.unobserve(canvas.parentElement)
      }
      mutationObserver?.disconnect()
      if (windowResizeHandler) {
        window.removeEventListener('resize', windowResizeHandler)
      }
    } catch {}
  }
}
