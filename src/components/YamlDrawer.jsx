import { useState, useEffect, useRef } from 'react'
import yaml from 'js-yaml'
import CodeMirror from '@uiw/react-codemirror'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { modalBackdrop, hoverRow, zModal } from '../design/designSystem'
import { ModalHeader } from './SharedComponents'

/**
 * Right-hand side drawer hosting an editable YAML pane with two-way binding to
 * the working roster document. It also doubles as the import surface:
 *
 * - When `data` is null (nothing loaded): the editor starts empty and valid
 *   YAML is committed via `onImport(text)` (a fresh session).
 * - When `data` exists: the editor mirrors it live. External edits (generation,
 *   pill edits, drag swaps, undo) refresh the text; valid edits are pushed via
 *   `onReplace(parsed)` and the roster updates in place. While the text is
 *   invalid, the error is shown and the last valid state is kept.
 */
function toYamlText(data) {
  if (!data) return ''
  const { warnings, ...clean } = data
  void warnings
  return yaml.dump(clean, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false })
}

export default function YamlDrawer({ open, onClose, data, onReplace, onImport }) {
  const [text, setText] = useState(() => toYamlText(data))
  const [errors, setErrors] = useState([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Normalized form of what we last synced/pushed — used to detect genuine
  // external changes and to avoid echoing our own pushes back into the editor.
  const syncedTextRef = useRef(text)

  // UI -> text: refresh from `data` when it changes externally.
  useEffect(() => {
    const next = toYamlText(data)
    if (next !== syncedTextRef.current) {
      syncedTextRef.current = next
      setText(next)
      setErrors([])
      setDirty(false)
    }
  }, [data])

  // text -> UI: debounced parse + validate + push.
  useEffect(() => {
    if (!dirty) return
    const id = setTimeout(async () => {
      if (!text.trim()) {
        setErrors([])
        return
      }
      let parsed
      try {
        parsed = yaml.load(text)
      } catch (err) {
        setErrors([`YAML syntax error: ${err.message}`])
        return
      }

      // Both onReplace (live edit) and onImport (fresh session) return the same
      // async { ok, errors } contract, so they are handled uniformly here.
      const commit = data ? onReplace : (p, raw) => onImport(raw)
      const result = await commit(parsed, text)
      if (result && !result.ok) {
        setErrors(result.errors)
      } else {
        setErrors([])
        if (data) syncedTextRef.current = toYamlText(parsed)
        setDirty(false)
      }
    }, 500)
    return () => clearTimeout(id)
  }, [text, dirty, data, onReplace, onImport])

  const handleEditorChange = (value) => {
    setText(value)
    setDirty(true)
  }

  const handleCopy = () => {
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => handleEditorChange(ev.target.result)
    reader.onerror = () => setErrors(['Failed to read file'])
    reader.readAsText(file)
  }

  const handleLoadSample = async () => {
    setBusy(true)
    try {
      const basePath = import.meta.env.BASE_URL || '/'
      const response = await fetch(`${basePath}sample.yaml`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      handleEditorChange(await response.text())
    } catch {
      setErrors(['Failed to load sample file'])
    } finally {
      setBusy(false)
    }
  }

  const valid = errors.length === 0
  const status = !data && !text.trim()
    ? 'empty'
    : !valid
      ? 'invalid'
      : dirty
        ? 'editing…'
        : 'in sync'

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 ${zModal} ${modalBackdrop} transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
      />

      {/* Drawer: bottom-sheet on mobile, right-side drawer on sm+ */}
      <aside
        className={`fixed ${zModal} flex transform flex-col bg-white/85 backdrop-blur-xl shadow-2xl transition-transform duration-300 ease-out
          inset-x-0 bottom-0 h-[85vh] rounded-t-2xl pb-safe sm:pb-0
          sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:w-full sm:max-w-xl sm:rounded-none
          ${open ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-x-full sm:translate-y-0'}`}
        role="dialog"
        aria-label="YAML editor"
      >
        {/* Grab handle (mobile bottom-sheet affordance) */}
        <div className="flex justify-center pt-2 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <ModalHeader title="YAML" onClose={onClose}>
          <span className={`text-xs font-medium ${valid ? 'text-gray-400' : 'text-red-500'}`}>
            ({status})
          </span>
        </ModalHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
          <label className={`cursor-pointer rounded border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 ${hoverRow}`}>
            <input type="file" accept=".yaml,.yml" onChange={handleFileUpload} className="hidden" />
            Upload file
          </label>
          <button
            onClick={handleLoadSample}
            disabled={busy}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Load sample
          </button>
          {text && (
            <button
              onClick={() => handleEditorChange('')}
              className="ml-auto px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-900"
            >
              Clear
            </button>
          )}
        </div>

        {/* Editor */}
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <div className="relative h-full overflow-hidden rounded border border-gray-300">
            {text && (
              <button
                onClick={handleCopy}
                className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-gray-200 backdrop-blur hover:bg-white hover:text-gray-900"
                title="Copy YAML to clipboard"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <CodeMirror
              value={text}
              onChange={handleEditorChange}
              extensions={[yamlLang()]}
              placeholder="Paste YAML, upload a file, or load the sample to begin…"
              height="100%"
              style={{
                height: '100%',
                fontSize: '13px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              }}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightActiveLine: true,
                foldGutter: true,
                autocompletion: false,
                tabSize: 2,
              }}
            />
          </div>
        </div>

        {/* Validation footer */}
        {!valid && (
          <div className="max-h-48 overflow-y-auto border-t border-red-200/60 bg-red-50/50 backdrop-blur-sm p-3 text-sm text-red-700">
            <ul className="list-inside list-disc space-y-1">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            {data && (
              <p className="mt-1 text-xs italic text-red-500">
                The roster keeps its last valid state until the YAML is fixed.
              </p>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
