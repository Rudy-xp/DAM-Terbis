// Séparé de importMetadata.ts pour que les bibliothèques Excel/CSV ne soient
// chargées qu'à l'ouverture de la fenêtre d'import.
import Papa from 'papaparse'
import { readSheet } from 'read-excel-file/browser'

type Cell = string | number | boolean | Date | null

/** Lit un fichier .xlsx ou .csv et renvoie un tableau de lignes. */
export async function readTable(file: File): Promise<string[][]> {
  const toText = (c: Cell) => (c == null ? '' : c instanceof Date ? c.toLocaleDateString('fr-FR') : String(c))
  if (/\.xlsx$/i.test(file.name)) {
    const rows = (await readSheet(file)) as Cell[][]
    return rows.map((r) => r.map(toText))
  }
  const text = await file.text()
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
  return parsed.data.map((r) => r.map((c) => (c ?? '').toString()))
}
