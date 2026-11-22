import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { booleanColumns, buildRows, fileKey, guessColumns, pickRow, type Columns, type ImportRow } from '../lib/importMetadata'
import { readTable } from '../lib/readTable'
import { connectDrive, DriveAuthError, hasToken, isDriveConfigured } from '../lib/google'
import { buildDriveRows, guessDriveColumns, importDriveRow, UnreadableFormatError, type DriveColumns, type DriveRow } from '../lib/driveImport'

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
  size_bytes: number
  drive_file_id: string | null
}

interface DriveProgress {
  state: 'idle' | 'running' | 'paused' | 'done'
  total: number
  done: number
  skipped: number
  failed: { name: string; error: string }[]
  message: string | null
}

async function fetchMyAssets(userId: string): Promise<MyAsset[]> {
  const all: MyAsset[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('assets')
      .select('id, file_name, description, tags, size_bytes, drive_file_id')
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
  const [cols, setCols] = useState<Columns>({ file: -1, description: -1, tags: -1, size: -1, place: -1 })
  const [flagCols, setFlagCols] = useState<number[]>([])
  const [overwrite, setOverwrite] = useState(true)
  const [assets, setAssets] = useState<MyAsset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [driveCols, setDriveCols] = useState<DriveColumns>({ id: -1, link: -1, path: -1 })
  const [skipCopies, setSkipCopies] = useState(true)
  const [drive, setDrive] = useState<DriveProgress>({ state: 'idle', total: 0, done: 0, skipped: 0, failed: [], message: null })
  const queueRef = useRef<DriveRow[] | null>(null)
  const indexRef = useRef(0)
  const stopRef = useRef(false)

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
      const header = guess.file >= 0 || guess.description >= 0 || guess.tags >= 0
      setHasHeader(header)
      setCols(guess)
      setFlagCols(header ? booleanColumns(rows[0], rows.slice(1)) : [])
      setDriveCols(header ? guessDriveColumns(rows[0]) : { id: -1, link: -1, path: -1 })
      queueRef.current = null
      indexRef.current = 0
      setDrive({ state: 'idle', total: 0, done: 0, skipped: 0, failed: [], message: null })
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

  const boolCols = useMemo(
    () => (hasHeader && table.length ? booleanColumns(table[0], table.slice(1)) : []),
    [table, hasHeader],
  )

  const rows: ImportRow[] = useMemo(
    () => (cols.file >= 0 ? buildRows(headers, hasHeader ? table.slice(1) : table, cols, flagCols) : []),
    [headers, table, hasHeader, cols, flagCols],
  )

  const { matches, ambiguous } = useMemo(() => {
    if (!assets) return { matches: [], ambiguous: 0 }
    const byKey = new Map<string, ImportRow[]>()
    for (const r of rows) byKey.set(r.file_key, [...(byKey.get(r.file_key) ?? []), r])
    const picks = assets.map((asset) => ({ asset, row: pickRow(byKey.get(fileKey(asset.file_name)) ?? [], asset.size_bytes) }))
    return {
      matches: picks.flatMap((p) => (p.row && p.row !== 'ambiguous' ? [{ asset: p.asset, row: p.row }] : [])),
      ambiguous: picks.filter((p) => p.row === 'ambiguous').length,
    }
  }, [assets, rows])

  const { rows: driveRows, unreadable } = useMemo(
    () =>
      cols.file >= 0 && (driveCols.id >= 0 || driveCols.link >= 0)
        ? buildDriveRows(headers, hasHeader ? table.slice(1) : table, cols, driveCols, flagCols, skipCopies)
        : { rows: [], unreadable: 0 },
    [headers, table, hasHeader, cols, driveCols, flagCols, skipCopies],
  )

  const driveTodo = useMemo(() => {
    if (!assets) return []
    const ids = new Set(assets.map((a) => a.drive_file_id).filter(Boolean))
    const keys = new Set(assets.map((a) => `${fileKey(a.file_name)}|${a.size_bytes}`))
    return driveRows.filter((r) => !ids.has(r.driveId) && !(r.size && keys.has(`${fileKey(r.name)}|${r.size}`)))
  }, [assets, driveRows])

  const driveRunning = drive.state === 'running'
  useEffect(() => {
    if (!driveRunning) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [driveRunning])

  async function runDrive() {
    setDrive((d) => ({ ...d, message: null }))
    try {
      if (!hasToken()) await connectDrive()
    } catch (e) {
      return setDrive((d) => ({ ...d, message: e instanceof Error ? e.message : String(e) }))
    }
    queueRef.current ??= [...driveTodo]
    const queue = queueRef.current
    stopRef.current = false
    let authLost = false
    setDrive((d) => ({ ...d, state: 'running', total: queue.length }))

    const worker = async () => {
      while (indexRef.current < queue.length && !stopRef.current) {
        if (!hasToken()) {
          authLost = true
          stopRef.current = true
          break
        }
        const row = queue[indexRef.current++]
        try {
          await importDriveRow(row, userId)
          setDrive((d) => ({ ...d, done: d.done + 1 }))
        } catch (e) {
          if (e instanceof UnreadableFormatError) {
            setDrive((d) => ({ ...d, skipped: d.skipped + 1 }))
          } else if (e instanceof DriveAuthError) {
            queue.push(row) // à refaire après reconnexion
            authLost = true
            stopRef.current = true
          } else {
            const error = e instanceof Error ? e.message : String(e)
            setDrive((d) => ({ ...d, failed: [...d.failed, { name: row.name, error }] }))
          }
        }
      }
    }
    await Promise.all(Array.from({ length: 3 }, worker))
    onDone()
    fetchMyAssets(userId).then(setAssets).catch(() => {})
    const finished = indexRef.current >= queue.length
    setDrive((d) => ({
      ...d,
      state: finished ? 'done' : 'paused',
      message: finished
        ? null
        : authLost
          ? 'L’accès Google expire au bout d’une heure : cliquez sur « Continuer » pour le renouveler.'
          : 'Import en pause.',
    }))
  }

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      // 1. Mémorise les descriptions pour les prochains envois
      for (let i = 0; i < rows.length; i += 500) {
        setProgress(`Enregistrement des descriptions… ${Math.min(i + 500, rows.length)}/${rows.length}`)
        const { error } = await supabase
          .from('imported_metadata')
          .upsert(rows.slice(i, i + 500), { onConflict: 'owner_id,file_key,size_bytes' })
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

  const select = (key: keyof Columns, label: string, optional: boolean) => (
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
    <div className="overlay" onClick={busy || driveRunning ? undefined : onClose}>
      <div className="dialog card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Importer des descriptions">
        <button className="close" onClick={onClose} disabled={busy || driveRunning} aria-label="Fermer">
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
              {select('size', 'Taille (octets)', true)}
              {select('place', 'Lieu → mot-clé', true)}
            </div>
            {cols.size < 0 && (
              <p className="muted small">
                Sans colonne « taille », deux fichiers de même nom dans des dossiers différents ne peuvent pas être
                distingués : ils sont alors ignorés.
              </p>
            )}
            {boolCols.length > 0 && (
              <div className="field">
                <span className="field-label">Colonnes Vrai/Faux ajoutées aux mots-clés quand la valeur est « Vrai »</span>
                <div className="flags">
                  {boolCols.map((i) => (
                    <label key={i} className="check">
                      <input
                        type="checkbox"
                        checked={flagCols.includes(i)}
                        onChange={(e) =>
                          setFlagCols(e.target.checked ? [...flagCols, i] : flagCols.filter((x) => x !== i))
                        }
                      />
                      {headers[i]}
                    </label>
                  ))}
                </div>
              </div>
            )}

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
                  {ambiguous > 0 && (
                    <>
                      {' '}
                      · <strong>{ambiguous}</strong> ignoré{ambiguous > 1 ? 's' : ''} (nom en double, taille différente)
                    </>
                  )}
                </p>
                <label className="check">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  Remplacer les descriptions existantes (y compris celles générées par l'IA)
                </label>
              </>
            )}
          </>
        )}


        {isDriveConfigured && fileName && cols.file >= 0 && (driveCols.id >= 0 || driveCols.link >= 0) && (
          <section className="drive-box">
            <h3>Fichiers Google Drive</h3>
            <p className="muted small">
              Le fichier contient les identifiants Drive : l'app peut cataloguer les fichiers directement. Les originaux
              restent dans Drive ; seul un aperçu léger est enregistré, avec un lien « Ouvrir dans Drive ».
            </p>
            {!isDriveConfigured ? (
              <p className="error small">
                Connexion Google non configurée : ajoutez la variable <code>VITE_GOOGLE_CLIENT_ID</code> (voir le README).
              </p>
            ) : (
              <>
                <div className="cols">
                  <label>
                    Identifiant Drive
                    <select value={driveCols.id} onChange={(e) => setDriveCols({ ...driveCols, id: Number(e.target.value) })}>
                      <option value={-1}>— aucune —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Lien Drive
                    <select value={driveCols.link} onChange={(e) => setDriveCols({ ...driveCols, link: Number(e.target.value) })}>
                      <option value={-1}>— aucune —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Chemin d'origine
                    <select value={driveCols.path} onChange={(e) => setDriveCols({ ...driveCols, path: Number(e.target.value) })}>
                      <option value={-1}>— aucune —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={skipCopies}
                    disabled={drive.state !== 'idle'}
                    onChange={(e) => setSkipCopies(e.target.checked)}
                  />
                  Ignorer les copies identiques (même nom et même taille dans plusieurs dossiers)
                </label>
                <p className="summary">
                  <strong>{driveRows.length}</strong> fichier{driveRows.length > 1 ? 's' : ''} Drive ·{' '}
                  <strong>{assets ? driveRows.length - driveTodo.length : '…'}</strong> déjà dans l'app ·{' '}
                  <strong>{assets ? driveTodo.length : '…'}</strong> à cataloguer
                  {unreadable > 0 && (
                    <>
                      {' '}
                      · <strong>{unreadable}</strong> ignoré{unreadable > 1 ? 's' : ''} (PSD, AI, EPS… non lisibles)
                    </>
                  )}
                </p>
                {drive.state !== 'idle' && (
                  <>
                    <progress max={drive.total || 1} value={drive.done + drive.skipped + drive.failed.length} />
                    <p className="small">
                      {drive.done} catalogué{drive.done > 1 ? 's' : ''}
                      {drive.skipped > 0 && <> · {drive.skipped} ignoré{drive.skipped > 1 ? 's' : ''} (format non lisible)</>}
                      {drive.failed.length > 0 && <> · {drive.failed.length} en erreur</>} sur {drive.total}
                      {drive.state === 'done' && ' — terminé ✓'}
                    </p>
                  </>
                )}
                {drive.message && <p className="muted small">{drive.message}</p>}
                {drive.failed.length > 0 && (
                  <details>
                    <summary className="small">Voir les erreurs</summary>
                    <ul className="small failed">
                      {drive.failed.map((f, i) => (
                        <li key={i}>
                          <strong>{f.name}</strong> : {f.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="actions">
                  {driveRunning ? (
                    <button onClick={() => (stopRef.current = true)}>Pause</button>
                  ) : (
                    drive.state !== 'done' && (
                      <button className="primary" onClick={runDrive} disabled={!assets || (drive.state === 'idle' && !driveTodo.length)}>
                        {drive.state === 'paused' ? 'Continuer' : 'Connecter Google Drive et importer'}
                      </button>
                    )
                  )}
                </div>
              </>
            )}
          </section>
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
          <button onClick={onClose} disabled={busy || driveRunning}>
            {done || drive.state === 'done' ? 'Fermer' : 'Annuler'}
          </button>
          {!done && (
            <button className="primary" onClick={apply} disabled={busy || !rows.length || !assets}>
              {busy ? 'Import…' : 'Importer les descriptions'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
