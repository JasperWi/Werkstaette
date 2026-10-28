import React from 'react';

export const ROLE_CONFIGS = {
  ignore: {
    key: 'ignore',
    label: '— Spalte ignorieren —',
    shortLabel: 'Ignorieren',
    headerBg: 'bg-gray-100 border-gray-300',
    cellBg: 'bg-gray-50/40 text-gray-500',
    badgeClass: 'bg-gray-200 text-gray-700 border-gray-300',
    selectClass: 'border-gray-300 bg-white text-gray-700',
  },
  name: {
    key: 'name',
    label: '👤 Schülername (Vollständiger Name) *',
    shortLabel: 'Schülername',
    headerBg: 'bg-emerald-50 border-emerald-300',
    cellBg: 'bg-emerald-50/40 text-emerald-950 font-medium',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    selectClass: 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold ring-1 ring-emerald-400',
    required: true,
  },
  firstName: {
    key: 'firstName',
    label: '👤 Vorname (wird mit Nachname kombiniert)',
    shortLabel: 'Vorname',
    headerBg: 'bg-teal-50 border-teal-300',
    cellBg: 'bg-teal-50/40 text-teal-950',
    badgeClass: 'bg-teal-100 text-teal-800 border-teal-300',
    selectClass: 'border-teal-400 bg-teal-50 text-teal-900 font-medium',
  },
  lastName: {
    key: 'lastName',
    label: '👤 Nachname (wird mit Vorname kombiniert)',
    shortLabel: 'Nachname',
    headerBg: 'bg-teal-50 border-teal-300',
    cellBg: 'bg-teal-50/40 text-teal-950',
    badgeClass: 'bg-teal-100 text-teal-800 border-teal-300',
    selectClass: 'border-teal-400 bg-teal-50 text-teal-900 font-medium',
  },
  class: {
    key: 'class',
    label: '🏫 Klasse / Lerngruppe',
    shortLabel: 'Klasse',
    headerBg: 'bg-blue-50 border-blue-300',
    cellBg: 'bg-blue-50/40 text-blue-950',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
    selectClass: 'border-blue-400 bg-blue-50 text-blue-900 font-semibold',
  },
  q1: {
    key: 'q1',
    label: '⭐ 1. Wunsch (Erstwunsch / Q1) *',
    shortLabel: '1. Wunsch',
    headerBg: 'bg-purple-50 border-purple-300',
    cellBg: 'bg-purple-50/40 text-purple-950 font-medium',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
    selectClass: 'border-purple-500 bg-purple-50 text-purple-900 font-semibold ring-1 ring-purple-400',
    required: true,
  },
  q2: {
    key: 'q2',
    label: '⭐ 2. Wunsch (Zweitwunsch / Q2)',
    shortLabel: '2. Wunsch',
    headerBg: 'bg-indigo-50 border-indigo-300',
    cellBg: 'bg-indigo-50/40 text-indigo-950',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    selectClass: 'border-indigo-400 bg-indigo-50 text-indigo-900 font-semibold',
  },
  q3: {
    key: 'q3',
    label: '⭐ 3. Wunsch (Drittwunsch / Q3)',
    shortLabel: '3. Wunsch',
    headerBg: 'bg-violet-50 border-violet-300',
    cellBg: 'bg-violet-50/40 text-violet-950',
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-300',
    selectClass: 'border-violet-400 bg-violet-50 text-violet-900 font-medium',
  },
  assistant: {
    key: 'assistant',
    label: '🤝 Lernbegleitung / Assistenz',
    shortLabel: 'Lernbegleitung',
    headerBg: 'bg-amber-50 border-amber-300',
    cellBg: 'bg-amber-50/40 text-amber-950',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    selectClass: 'border-amber-400 bg-amber-50 text-amber-900 font-semibold',
  },
};

export default function ColumnMappingModal({
  isOpen,
  onClose,
  fileName,
  targetBand,
  onTargetBandChange,
  activeBandIds = [],
  getBandLabel = (b) => b,
  headers = [],
  previewRows = [],
  totalRows = 0,
  mappings = {},
  onMappingChange,
  onResetMappings,
  onConfirm,
}) {
  if (!isOpen) return null;

  // Validation checks
  const hasFullName = Object.values(mappings).includes('name');
  const hasFirstAndLast =
    Object.values(mappings).includes('firstName') && Object.values(mappings).includes('lastName');
  const hasName = hasFullName || hasFirstAndLast;
  const hasQ1 = Object.values(mappings).includes('q1');
  const hasQ2 = Object.values(mappings).includes('q2');
  const hasClass = Object.values(mappings).includes('class');
  const hasAssistant = Object.values(mappings).includes('assistant');
  const canImport = hasName && hasQ1;

  // Helper to get column letter (0 = A, 1 = B, etc.)
  const getColLetter = (idx) => String.fromCharCode(65 + (idx % 26));

  // Find assigned column info for status badges
  const getMappedColumnInfo = (roleKey) => {
    const colIdx = Object.keys(mappings).find((k) => mappings[k] === roleKey);
    if (colIdx === undefined) return null;
    const idx = parseInt(colIdx, 10);
    const headerTitle = headers[idx] ? `„${headers[idx]}"` : `Spalte ${idx + 1}`;
    return {
      idx,
      letter: getColLetter(idx),
      title: headerTitle,
    };
  };

  const nameInfo = getMappedColumnInfo('name');
  const firstNameInfo = getMappedColumnInfo('firstName');
  const lastNameInfo = getMappedColumnInfo('lastName');
  const q1Info = getMappedColumnInfo('q1');
  const q2Info = getMappedColumnInfo('q2');
  const classInfo = getMappedColumnInfo('class');
  const assistantInfo = getMappedColumnInfo('assistant');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col border border-gray-200 overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 via-white to-blue-50 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200">
                Wahl-Upload
              </span>
              <h2 className="text-xl font-bold text-gray-900">
                Spaltenzuordnung & Vorschau
              </h2>
            </div>
            <p className="text-xs text-gray-600 mt-1 flex items-center gap-2">
              <span className="font-semibold text-gray-800">📄 Datei:</span>
              <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700">{fileName}</span>
              <span>•</span>
              <span className="font-semibold text-emerald-700">{totalRows} Datensätze gefunden</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Target band selector */}
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-300 shadow-sm">
              <label htmlFor="modal-band-select" className="text-xs font-semibold text-gray-600 whitespace-nowrap">
                Ziel-Band:
              </label>
              <select
                id="modal-band-select"
                value={targetBand}
                onChange={(e) => onTargetBandChange && onTargetBandChange(e.target.value)}
                className="text-xs font-semibold text-blue-900 bg-transparent border-none focus:ring-0 cursor-pointer"
              >
                {activeBandIds.map((bandId) => (
                  <option key={bandId} value={bandId}>
                    {getBandLabel(bandId)}
                  </option>
                ))}
              </select>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="Schließen"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Guidance and status overview banner */}
        <div className="px-6 py-3 bg-blue-50/70 border-b border-blue-200">
          <div className="text-xs text-blue-900 leading-relaxed mb-2.5">
            💡 <strong>Spaltenzuordnung festlegen:</strong> Die Spaltennamen in Umfragen (z.B. Google Forms, Microsoft Forms, Excel)
            können abweichen. Wählen Sie über jedem <strong>Spaltentitel aus Ihrer Datei</strong> die passende <strong>interne Spalte</strong> aus dem Dropdown.
            Die <strong>5-Zeilen-Vorschau</strong> zeigt die Originalwerte zur einfachen Kontrolle.
          </div>

          {/* Quick status badges */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="font-semibold text-gray-700">Zuordnungs-Status:</span>

            {/* Schülername status */}
            {hasFullName ? (
              <span className="px-2.5 py-1 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-800 font-medium">
                ✓ Schülername: <strong className="font-bold">{nameInfo?.letter} ({nameInfo?.title})</strong>
              </span>
            ) : hasFirstAndLast ? (
              <span className="px-2.5 py-1 rounded-md bg-teal-100 border border-teal-300 text-teal-800 font-medium">
                ✓ Vorname: {firstNameInfo?.letter} &amp; Nachname: {lastNameInfo?.letter}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md bg-red-100 border border-red-300 text-red-800 font-semibold animate-pulse">
                ✗ Schülername fehlt (Erforderlich)
              </span>
            )}

            {/* 1. Wunsch status */}
            {hasQ1 ? (
              <span className="px-2.5 py-1 rounded-md bg-purple-100 border border-purple-300 text-purple-800 font-medium">
                ✓ 1. Wunsch (Q1): <strong className="font-bold">{q1Info?.letter} ({q1Info?.title})</strong>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md bg-red-100 border border-red-300 text-red-800 font-semibold animate-pulse">
                ✗ 1. Wunsch fehlt (Erforderlich)
              </span>
            )}

            {/* 2. Wunsch status */}
            {hasQ2 ? (
              <span className="px-2.5 py-1 rounded-md bg-indigo-100 border border-indigo-300 text-indigo-800 font-medium">
                ✓ 2. Wunsch: <strong className="font-bold">{q2Info?.letter} ({q2Info?.title})</strong>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md bg-gray-100 border border-gray-300 text-gray-600">
                – 2. Wunsch (optional)
              </span>
            )}

            {/* Klasse status */}
            {hasClass ? (
              <span className="px-2.5 py-1 rounded-md bg-blue-100 border border-blue-300 text-blue-800 font-medium">
                ✓ Klasse: <strong className="font-bold">{classInfo?.letter} ({classInfo?.title})</strong>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-md bg-gray-100 border border-gray-300 text-gray-600">
                – Klasse (optional)
              </span>
            )}

            {/* Lernbegleitung status */}
            {hasAssistant && (
              <span className="px-2.5 py-1 rounded-md bg-amber-100 border border-amber-300 text-amber-800 font-medium">
                ✓ Lernbegleitung: <strong className="font-bold">{assistantInfo?.letter} ({assistantInfo?.title})</strong>
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Preview Table Container */}
        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          <div className="inline-block min-w-full align-middle">
            <div className="border border-gray-300 rounded-xl overflow-hidden shadow-sm bg-white">
              <table className="min-w-full divide-y divide-gray-200 border-collapse text-left">
                {/* Table Header: Dropdowns + File column titles */}
                <thead>
                  <tr className="divide-x divide-gray-200 bg-gray-100">
                    {/* Sticky row indicator header */}
                    <th className="sticky left-0 z-20 w-24 bg-gray-200 px-3 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wider border-b border-gray-300 shadow-[1px_0_0_0_rgba(0,0,0,0.1)]">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span>Zeile</span>
                        <span className="text-[10px] text-gray-500 font-normal">Kopf / Daten</span>
                      </div>
                    </th>

                    {/* Each column in uploaded file */}
                    {headers.map((origHeader, colIdx) => {
                      const currentRole = mappings[colIdx] || 'ignore';
                      const config = ROLE_CONFIGS[currentRole] || ROLE_CONFIGS.ignore;
                      const colLetter = getColLetter(colIdx);

                      return (
                        <th
                          key={colIdx}
                          className={`min-w-[240px] max-w-[320px] p-3 border-b-2 transition-colors ${config.headerBg}`}
                        >
                          <div className="space-y-2">
                            {/* Top: Dropdown for Internal Column Name */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label
                                  htmlFor={`mapping-select-${colIdx}`}
                                  className="text-[11px] font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1"
                                >
                                  <span>Interne Spalte:</span>
                                </label>
                                <span className="text-[11px] font-mono font-bold text-gray-500 bg-white/80 px-1.5 py-0.5 rounded border border-gray-300">
                                  Spalte {colLetter}
                                </span>
                              </div>
                              <select
                                id={`mapping-select-${colIdx}`}
                                value={currentRole}
                                onChange={(e) => onMappingChange(colIdx, e.target.value)}
                                className={`w-full text-xs rounded-lg px-2.5 py-1.5 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 cursor-pointer ${config.selectClass}`}
                              >
                                {Object.values(ROLE_CONFIGS).map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Middle: File's Original Column Title */}
                            <div className="pt-2 border-t border-gray-200/80">
                              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                                Spaltentitel aus Datei:
                              </span>
                              <div
                                className="text-xs font-bold text-gray-900 break-words mt-0.5 max-h-12 overflow-y-auto leading-snug"
                                title={origHeader || `Spalte ${colIdx + 1}`}
                              >
                                {origHeader ? (
                                  <span>„{origHeader}"</span>
                                ) : (
                                  <span className="text-gray-400 italic">(Kein Titel)</span>
                                )}
                              </div>
                            </div>

                            {/* Bottom: Current Role Badge */}
                            <div className="pt-1 flex items-center justify-between">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${config.badgeClass}`}
                              >
                                {currentRole === 'ignore' ? 'Ignorieren' : `✓ ${config.shortLabel}`}
                              </span>
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                {/* Table Body: 5-Line Preview */}
                <tbody className="divide-y divide-gray-200 bg-white">
                  {previewRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={headers.length + 1}
                        className="px-6 py-8 text-center text-sm text-gray-500 italic"
                      >
                        Keine Datenzeilen in der Datei gefunden.
                      </td>
                    </tr>
                  ) : (
                    previewRows.map((row, rowIdx) => (
                      <tr
                        key={rowIdx}
                        className="hover:bg-blue-50/20 transition-colors divide-x divide-gray-200"
                      >
                        {/* Sticky row number cell */}
                        <td className="sticky left-0 z-10 w-24 bg-gray-50 px-3 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                          <span className="px-2 py-0.5 rounded bg-gray-200/70 text-gray-700">
                            Zeile {rowIdx + 1}
                          </span>
                        </td>

                        {/* Cells for each column */}
                        {headers.map((_, colIdx) => {
                          const currentRole = mappings[colIdx] || 'ignore';
                          const config = ROLE_CONFIGS[currentRole] || ROLE_CONFIGS.ignore;
                          const cellVal = row && row[colIdx] !== undefined ? String(row[colIdx]) : '';
                          const isEmpty = !cellVal || cellVal.trim() === '';

                          return (
                            <td
                              key={colIdx}
                              className={`px-3 py-2 text-xs transition-colors whitespace-nowrap overflow-hidden text-ellipsis max-w-[320px] ${config.cellBg}`}
                              title={cellVal}
                            >
                              {isEmpty ? (
                                <span className="text-gray-400 italic select-none font-sans text-[11px]">
                                  (leer)
                                </span>
                              ) : (
                                <span className="font-mono text-xs">{cellVal}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onResetMappings}
              type="button"
              className="px-3.5 py-1.5 text-xs font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              title="Automatische Erkennung der Spalten erneut durchführen"
            >
              <span>↺</span>
              <span>Auto-Erkennung zurücksetzen</span>
            </button>
            <span className="text-xs text-gray-500">
              5-Zeilen-Vorschau aktiv • Insgesamt {totalRows} Schülerzeilen in Datei
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg shadow-sm transition-colors"
            >
              Abbrechen
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={!canImport}
              className={`px-5 py-2 text-xs font-bold text-white rounded-lg shadow-md transition-all flex items-center gap-2 ${
                canImport
                  ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 hover:shadow-lg cursor-pointer'
                  : 'bg-gray-400 cursor-not-allowed opacity-60'
              }`}
              title={
                !canImport
                  ? 'Bitte ordnen Sie mindestens "Schülername" und "1. Wunsch" zu.'
                  : `Daten für ${getBandLabel(targetBand)} importieren`
              }
            >
              <span>✓</span>
              <span>
                {canImport
                  ? `${totalRows} Datensätze für ${getBandLabel(targetBand)} importieren`
                  : 'Schülername & 1. Wunsch erforderlich'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
