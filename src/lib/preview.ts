// Génération d'aperçus JPEG dans le navigateur (photos et 1re page des PDF).
export const PREVIEW_MAX = 1568

export interface Preview {
  width: number
  height: number
  jpeg: Blob | null
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
}

/** Réduit une image (Blob) en JPEG de PREVIEW_MAX px maximum. Renvoie null si le navigateur ne sait pas la lire. */
export function imagePreview(blob: Blob): Promise<Preview | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = async () => {
      const { naturalWidth: width, naturalHeight: height } = img
      const scale = Math.min(1, PREVIEW_MAX / Math.max(width, height, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      }
      const jpeg = ctx ? await canvasToJpeg(canvas) : null
      URL.revokeObjectURL(url)
      resolve({ width, height, jpeg })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** Rend la première page d'un PDF en JPEG (pdf.js chargé à la demande). */
export async function pdfPreview(blob: Blob): Promise<Preview | null> {
  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
    const doc = await task.promise
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, PREVIEW_MAX / Math.max(base.width, base.height)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      return { width: canvas.width, height: canvas.height, jpeg: await canvasToJpeg(canvas) }
    } finally {
      await task.destroy()
    }
  } catch {
    return null
  }
}
