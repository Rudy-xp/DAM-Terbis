import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildRows, fileKey, guessColumns, type ImportRow } from '../lib/importMetadata'
import { readTable } from '../lib/readTable'

interface Props {
  userId: string
  onClose: () => void
  onDone: () => void
}

interface MyAsset {
  id: string
  file_name: string
  description: string | null
  tags: string[]
}

async function fetchMyAssets(userId: string): Promise<MyAsset[]> {
  const all: MyAsset[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('assets')
      .select('id, file_name, description, tags')
      .eq('owner_id', userId)
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data as MyAsset[]))
    if (!data || data.length < 1000) return all
  }
}

export default function ImportDialog({ userId, onClose, onDone }: Props) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [table, setTable] = useState<string[][]>([])
  const [hasHeader, setHasHeader] = useState(true)
  const [cols, setCols] = useState({ file: -1, description: -1, tags: -1 })
  const [overwrite, setOverwrite] = useState(true)
  const [assets, setAssets] = useState<MyAsset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetchMyAssets(userId)
      .then(setAssets)
      .catch((e) => setError(e.message))
  }, [userId])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setDone(false)
    try {
      const rows = await readTable(file)
      if (!rows.length) throw new Error('Le fichier est vide')
      setFileName(file.name)
      setTable(rows)
      const guess = guessColumns(rows[0])
      setHasHeader(guess.file >= 0 || guess.description >= 0 || guess.tags >= 0)
      setCols(guess)
    } catch (e) {
      setError(`Lecture impossible : ${e instanceof Error ? e.message : e}. Utilisez un fichier .xlsx ou .csv.`)
    }
  }

  const headers = useMemo(() => {
    const width = Math.max(0, ...table.slice(0, 50).map((r) => r.length))
    return Array.from({ length: width }, (_, i) =>
      hasHeader && table[0]?.[i]?.trim() ? table[0][i].trim() : `Colonne ${String.fromCharCode(65 + (i % 26))}`,
    )
  }, [table, hasHeader])

  const rows: ImportRow[] = useMemo(
    () => (cols.file >= 0 ? buildRows(hasHeader ? table.slice(1) : table, cols) : []),
    [table, hasHeader, cols],
  )

  const matches = useMemo(() => {
    if (!assets) return []
    const byKey = new Map(rows.map((r) => [r.file_key, r]))
    return assets.flatMap((a) => {
      const row = byKey.get(fileKey(a.file_name))
      return row ? [{ asset: a, row }] : []
    })
  }, [assets, rows])

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      // 1. Mémorise les descriptions pour les prochains envois
      for (let i = 0; i < rows.length; i += 500) {
        setProgress(`Enregistrement des descriptions… ${Math.min(i + 500, rows.length)}/${rows.length}`)
        const { error } = await supabase
          .from('imported_metadata')
          .upsert(rows.slice(i, i + 500), { onConflict: 'owner_id,file_key' })
        if (error) throw error
      }
      // 2. Met à jour les fichiers déjà présents
      let n = 0
      let next = 0
      const worker = async () => {
        while (next < matches.length) {
          const { asset, row } = matches[next++]
          const patch: Record<string, unknown> = { tags: [...new Set([...asset.tags, ...row.tags])] }
          if (row.description && (overwrite || !asset.description)) {
            patch.description = row.description
            patch.ai_status = null
            patch.ai_error = null
          }
          const { error } = await supabase.from('assets').update(patch).eq('id', asset.id)
          if (error) throw error
          setProgress(`Mise à jour des fichiers… ${++n}/${matches.length}`)
        }
      }
      await Promise.all(Array.from({ length: 5 }, worker))
      setDone(true)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const select = (key: 'file' | 'description' | 'tags', label: string, optional: boolean) => (
    <label>
      {label}
      <select value={cols[key]} onChange={(e) => setCols({ ...cols, [key]: Number(e.target.value) })}>
        <option value={-1}>{optional ? '— aucune —' : '— choisir —'}</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Importer des descriptions">
        <button className="close" onClick={onClose} disabled={busy} aria-label="Fermer">
          ×
        </button>
        <h2>Importer des descriptions</h2>
        <p className="muted small">
          Fichier Excel (.xlsx) ou CSV avec une colonne « nom de fichier » et une colonne « description » (et
          éventuellement « mots-clés »). Les lignes sont associées aux photos par leur nom de fichier, extension
          ignorée. Elles s'appliquent aux fichiers déjà envoyés et à ceux que vous enverrez ensuite.
        </p>

        <input type="file" accept=".xlsx,.csv,text/csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />

        {fileName && table.length > 0 && (
          <>
            <label className="check">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              La première ligne contient les titres des colonnes
            </label>
            <div className="cols">
              {select('file', 'Nom du fichier *', false)}
              {select('description', 'Description', true)}
              {select('tags', 'Mots-clés', true)}
            </div>

            {cols.file >= 0 && (
              <>
                <div className="preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Fichier</th>
                        <th>Description</th>
                        <th>Mots-clés</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r) => (
                        <tr key={r.file_key}>
                          <td>{r.file_key}</td>
                          <td>{r.description}</td>
                          <td>{r.tags.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="summary">
                  <strong>{rows.length}</strong> ligne{rows.length > 1 ? 's' : ''} exploitable{rows.length > 1 ? 's' : ''} ·{' '}
                  <strong>{assets ? matches.length : '…'}</strong> fichier{matches.length > 1 ? 's' : ''} déjà envoyé
                  {matches.length > 1 ? 's' : ''} correspond{matches.length > 1 ? 'ent' : ''}
                </p>
                <label className="check">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  Remplacer les descriptions existantes (y compris celles générées par l'IA)
                </label>
              </>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
        {progress && <p className="muted small">{progress}</p>}
        {done && (
          <p className="info">
            Import terminé : {matches.length} fichier{matches.length > 1 ? 's' : ''} mis à jour, {rows.length} description
            {rows.length > 1 ? 's' : ''} mémorisée{rows.length > 1 ? 's' : ''} pour les prochains envois.
          </p>
        )}

        <div className="actions">
          <button onClick={onClose} disabled={busy}>
            {done ? 'Fermer' : 'Annuler'}
          </button>
          {!done && (
            <button className="primary" onClick={apply} disabled={busy || !rows.length || !assets}>
              {busy ? 'Import…' : 'Importer'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
