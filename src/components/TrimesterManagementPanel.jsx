import React, { useMemo, useState, useCallback } from 'react';
import {
  createTrimesterPlan,
  ensurePlanCourses,
  getPlanBandIds,
  jahrgangColor,
  trimesterPlanKey,
} from '../trimesterPlans';
import StudentFlowView from './StudentFlowView';

const ENTRY_STUFE = 5;

function jahrgangForStufe(schoolYearStart, stufe) {
  if (schoolYearStart == null || stufe == null) return null;
  const year = Number(schoolYearStart) - (Number(stufe) - ENTRY_STUFE);
  return Number.isFinite(year) ? year : null;
}

const ALL_BAND_META = [
  { id: 'erstesBand', label: '1. Band', num: 1 },
  { id: 'zweitesBand', label: '2. Band', num: 2 },
  { id: 'drittesBand', label: '3. Band', num: 3 },
  { id: 'viertesBand', label: '4. Band', num: 4 },
  { id: 'fuenftesBand', label: '5. Band', num: 5 },
  { id: 'sechstesBand', label: '6. Band', num: 6 },
];

function BandChip({ bandId, active, color, onClick }) {
  const meta = ALL_BAND_META.find(b => b.id === bandId);
  return (
    <button
      type="button"
      title={meta?.label}
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
        active ? 'ring-2 ring-offset-1 ring-indigo-400 text-white border-transparent' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-300'
      }`}
      style={active && color ? { backgroundColor: color } : active ? { backgroundColor: '#4f46e5' } : undefined}
    >
      {meta?.label || bandId}
    </button>
  );
}

function TrimesterEditor({
  plan,
  workshopNames,
  klassenStufenPool,
  workshopColors,
  workshopTeachers,
  workshopRooms,
  workshops,
  getWorkshopCapacity,
  onChange,
  onDelete,
  onApplyBlueprint,
}) {
  const bandIds = getPlanBandIds(plan);
  const enriched = useMemo(
    () => ensurePlanCourses(plan, workshopNames, bandIds),
    [plan, workshopNames, bandIds]
  );

  const updatePlan = (patch) => {
    onChange({ ...enriched, ...patch, updatedAt: new Date().toISOString() });
  };

  const setBandCount = (count) => {
    const newIds = getPlanBandIds({ bandCount: count });
    const stufenBandAccess = { ...enriched.stufenBandAccess };
    klassenStufenPool.forEach(stufe => {
      if (!stufenBandAccess[stufe]) stufenBandAccess[stufe] = [...newIds];
      else stufenBandAccess[stufe] = stufenBandAccess[stufe].filter(id => newIds.includes(id));
    });
    updatePlan({ bandCount: count, stufenBandAccess });
  };

  const toggleStufeBand = (stufe, bandId) => {
    const current = enriched.stufenBandAccess[stufe] || [...bandIds];
    const next = current.includes(bandId) ? current.filter(id => id !== bandId) : [...current, bandId];
    updatePlan({ stufenBandAccess: { ...enriched.stufenBandAccess, [stufe]: next } });
  };

  const updateCourse = (name, coursePatch) => {
    updatePlan({
      courses: { ...enriched.courses, [name]: { ...enriched.courses[name], ...coursePatch } },
    });
  };

  const updateVariant = (courseName, variantId, patch) => {
    const variants = (enriched.courses[courseName]?.variants || []).map(variant =>
      variant.id === variantId ? { ...variant, ...patch } : variant
    );
    updateCourse(courseName, { variants });
  };

  const toggleCourseBand = (courseName, variantId, bandId) => {
    const variants = (enriched.courses[courseName]?.variants || []).map(variant => {
      const without = (variant.bandIds || []).filter(id => id !== bandId);
      if (variant.id !== variantId) return { ...variant, bandIds: without };
      const has = (variant.bandIds || []).includes(bandId);
      return { ...variant, bandIds: has ? without : [...without, bandId] };
    });
    updateCourse(courseName, { variants });
  };

  const addCourseVariant = courseName => {
    const variants = enriched.courses[courseName]?.variants || [];
    updateCourse(courseName, {
      variants: [
        ...variants,
        {
          id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          bandIds: [],
          capacity: null,
          room: null,
          teacher: null,
          color: null,
        },
      ],
    });
  };

  const removeCourseVariant = (courseName, variantId) => {
    const variants = enriched.courses[courseName]?.variants || [];
    if (variants.length <= 1) return;
    updateCourse(courseName, { variants: variants.filter(variant => variant.id !== variantId) });
  };

  const maybeOverwriteBlueprint = (field, workshopName, value) => {
    if (value == null || String(value).trim() === '') return;
    if (window.confirm(`„${value}“ als Standard in der Werkstatt-Blueprint („${workshopName}“) übernehmen?`)) {
      onApplyBlueprint(workshopName, { [field]: value });
    }
  };

  const sortedCourses = [...workshopNames].sort((a, b) => a.localeCompare(b, 'de'));

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-xl font-bold text-gray-900">
            Schuljahr {plan.schoolYearStart}/{plan.schoolYearEnd} · T{plan.trimester}
          </h4>
          <p className="text-xs text-gray-500 mt-1">Schlüssel: {plan.key}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
        >
          Trimester löschen
        </button>
      </div>

      <div className="space-y-4 p-4 bg-slate-100 rounded-xl border-2 border-slate-400">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Anzahl Parallel-Bänder</label>
            <select
              value={plan.bandCount}
              onChange={e => setBandCount(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              {[1, 2, 3, 4, 5, 6].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Wahlen pro Schüler</label>
            <select
              value={plan.wahlCount ?? 2}
              onChange={e => updatePlan({ wahlCount: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'Wahl' : 'Wahlen'}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Upload & Auto-Zuordnung in „Wahl & Zuordnung“
              {(plan.wahlCount ?? 2) > 3 ? ' · Datei-Import: Spalten für Wünsche 1–3' : ''}
            </p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notizen</label>
          <textarea
            value={plan.notes || ''}
            onChange={e => updatePlan({ notes: e.target.value })}
            placeholder="Notizen zu diesem Trimester"
            rows={6}
            className="w-full min-h-[9rem] px-3 py-2 border-2 border-slate-400 rounded-lg text-sm bg-white resize-y"
          />
        </div>
      </div>

      <div className="p-4 bg-teal-50 rounded-xl border-2 border-teal-800 space-y-3">
        <h5 className="font-semibold text-gray-800">Band-Untertitel</h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bandIds.map(bandId => (
            <label key={bandId} className="text-sm">
              <span className="text-gray-600 block mb-1">{ALL_BAND_META.find(b => b.id === bandId)?.label}</span>
              <input
                type="text"
                value={enriched.bandSubtitles?.[bandId] || ''}
                onChange={e =>
                  updatePlan({ bandSubtitles: { ...enriched.bandSubtitles, [bandId]: e.target.value } })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="z. B. Nachmittagsblock"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="p-4 bg-white rounded-xl border-2 border-slate-600 space-y-3">
        <h5 className="font-semibold text-gray-800">Klassenstufen → wählbare Bänder</h5>
        <p className="text-xs text-gray-500">
          Damit legen Sie fest, welcher Jahrgang an dieser Wahl teilnimmt. Kein Band bedeutet: dieses Trimester aussetzen. Im nächsten Trimester können Sie ihn wieder aufnehmen.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-4">Stufe</th>
                {bandIds.map(id => (
                  <th key={id} className="py-2 px-2 text-center">{ALL_BAND_META.find(b => b.id === id)?.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {klassenStufenPool.map(stufe => {
                const jahrgang = jahrgangForStufe(plan.schoolYearStart, stufe);
                const jahrgangTint = jahrgang == null ? null : jahrgangColor(jahrgang);
                return (
                <tr key={stufe} className="border-b border-gray-100">
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{stufe}</span>
                      {jahrgang != null && (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{ color: jahrgangTint, backgroundColor: `${jahrgangTint}1a` }}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: jahrgangTint }} />
                          Jahrgang {jahrgang}
                        </span>
                      )}
                    </div>
                  </td>
                  {bandIds.map(bandId => {
                    const allowed = (enriched.stufenBandAccess[stufe] || bandIds).includes(bandId);
                    return (
                      <td key={bandId} className="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={allowed}
                          onChange={() => toggleStufeBand(stufe, bandId)}
                          className="w-4 h-4"
                        />
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <h5 className="font-semibold text-gray-800">Kurse in diesem Trimester</h5>
        <p className="text-xs text-gray-500">
          Ein Kurs kann in mehreren Bändern laufen. Weichen Raum, Kapazität oder Lehrkraft ab, bekommt das Band eine eigene Variante.
        </p>
        {sortedCourses.map(name => {
          const course = enriched.courses[name];
          const variants = course.variants || [];
          const baseCap = getWorkshopCapacity(workshops[name], name);
          return (
            <div key={name} className={`p-4 rounded-xl border-2 ${course.enabled ? 'bg-white border-slate-400' : 'bg-slate-50 border-dashed border-slate-400 opacity-80'}`}>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <label className="flex items-center gap-2 font-semibold text-gray-900">
                  <input
                    type="checkbox"
                    checked={course.enabled !== false}
                    onChange={e => updateCourse(name, { enabled: e.target.checked })}
                  />
                  {name}
                </label>
                <span className="text-xs text-gray-500">Blueprint: {baseCap} Pl. · {workshopRooms[name] || '—'} · {workshopTeachers[name] || '—'}</span>
              </div>
              {course.enabled !== false && (
                <div className="space-y-3">
                  {variants.map((settings, index) => (
                    <div key={settings.id || index} className="space-y-2 rounded-lg border-2 border-slate-300 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-600">
                          {variants.length > 1 ? `Variante ${index + 1}` : 'Bänder'}
                        </span>
                        {variants.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeCourseVariant(name, settings.id)}
                            className="text-xs font-semibold text-red-700 hover:text-red-800"
                          >
                            Entfernen
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {bandIds.map(bandId => (
                          <BandChip
                            key={bandId}
                            bandId={bandId}
                            active={(settings.bandIds || []).includes(bandId)}
                            color={settings.color || workshopColors[name]}
                            onClick={() => toggleCourseBand(name, settings.id, bandId)}
                          />
                        ))}
                      </div>
                      {(settings.bandIds || []).length === 0 && variants.length > 1 && (
                        <p className="text-xs text-slate-500">Noch keinem Band zugeordnet. Ein Klick auf ein Band übernimmt es aus der anderen Variante.</p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="number"
                          min={0}
                          placeholder={`Kapazität (${baseCap})`}
                          value={settings.capacity ?? ''}
                          onChange={e => updateVariant(name, settings.id, { capacity: e.target.value === '' ? null : Number(e.target.value) })}
                          onBlur={() => settings.capacity != null && maybeOverwriteBlueprint('capacity', name, settings.capacity)}
                          className="px-2 py-1.5 border rounded-lg text-sm bg-white"
                        />
                        <input
                          type="text"
                          placeholder={`Raum (${workshopRooms[name] || '—'})`}
                          value={settings.room ?? ''}
                          onChange={e => updateVariant(name, settings.id, { room: e.target.value || null })}
                          onBlur={() => settings.room && maybeOverwriteBlueprint('room', name, settings.room)}
                          className="px-2 py-1.5 border rounded-lg text-sm bg-white"
                        />
                        <input
                          type="text"
                          placeholder={`Lehrkraft (${workshopTeachers[name] || '—'})`}
                          value={settings.teacher ?? ''}
                          onChange={e => updateVariant(name, settings.id, { teacher: e.target.value || null })}
                          onBlur={() => settings.teacher && maybeOverwriteBlueprint('teacher', name, settings.teacher)}
                          className="px-2 py-1.5 border rounded-lg text-sm bg-white"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addCourseVariant(name)}
                    className="rounded-lg border-2 border-dashed border-slate-400 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:border-teal-700 hover:bg-teal-50"
                  >
                    Variante hinzufügen
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function newVariant(bandIds, seed = {}) {
  return {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    bandIds: [...bandIds],
    capacity: seed.capacity ?? null,
    room: seed.room ?? null,
    teacher: seed.teacher ?? null,
    color: seed.color ?? null,
  };
}

function cloneVariants(course) {
  return (course?.variants || []).map(variant => ({
    ...variant,
    bandIds: [...(variant.bandIds || [])],
  }));
}

function dropEmptyVariants(variants) {
  const kept = variants.filter(variant => variant.bandIds.length > 0);
  if (kept.length) return kept;
  const leftover = variants[0] || newVariant([]);
  return [{ ...leftover, bandIds: [] }];
}

function addBandAsOwn(course, bandId) {
  const variants = cloneVariants(course);
  if (variants.some(variant => variant.bandIds.includes(bandId))) {
    return { ...course, enabled: true, variants };
  }
  if (variants.length === 1 && variants[0].bandIds.length === 0) {
    variants[0].bandIds = [bandId];
    return { ...course, enabled: true, variants };
  }
  return { ...course, enabled: true, variants: [...variants, newVariant([bandId])] };
}

function removeBandFromCourse(course, bandId) {
  const variants = dropEmptyVariants(
    cloneVariants(course).map(variant => ({
      ...variant,
      bandIds: variant.bandIds.filter(id => id !== bandId),
    }))
  );
  return { ...course, enabled: true, variants };
}

function bandLabel(bandId) {
  return ALL_BAND_META.find(band => band.id === bandId)?.label || bandId;
}

function joinBands(ids) {
  return ids.map(bandLabel).join(' und im ');
}

function variantNote(course, bandId, onThisBand) {
  const variants = (course?.variants || []).filter(item => (item.bandIds || []).length > 0);
  const here = variants.find(item => item.bandIds.includes(bandId));
  const same = (here?.bandIds || []).filter(id => id !== bandId);
  const other = variants
    .filter(item => !here || item.id !== here.id)
    .flatMap(item => item.bandIds)
    .filter(id => id !== bandId);
  if (!onThisBand) {
    const active = variants.flatMap(item => item.bandIds);
    if (!active.length) return 'Im Trimester noch in keinem Band.';
    return `Aktiv im ${joinBands(active)}.`;
  }
  if (!same.length && !other.length) return 'Eigene Variante, nur in diesem Band.';
  const parts = [];
  if (same.length) parts.push(`Gleiche Variante wie im ${joinBands(same)}`);
  else parts.push('Eigene Variante');
  if (other.length) parts.push(`im ${joinBands(other)} mit einer anderen Variante`);
  return `${parts.join(', ')}.`;
}

function BandEditor({
  plan,
  bandId,
  workshopNames,
  workshopColors,
  onChange,
}) {
  const bandIds = getPlanBandIds(plan);
  const enriched = useMemo(
    () => ensurePlanCourses(plan, workshopNames, bandIds),
    [plan, workshopNames, bandIds]
  );

  const updatePlan = (patch) => {
    onChange({ ...enriched, ...patch, updatedAt: new Date().toISOString() });
  };

  const updateCourse = (name, coursePatch) => {
    updatePlan({
      courses: { ...enriched.courses, [name]: { ...enriched.courses[name], ...coursePatch } },
    });
  };

  const subtitle = enriched.bandSubtitles?.[bandId]?.trim();
  const names = [...workshopNames].sort((a, b) => a.localeCompare(b, 'de'));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h4 className="text-xl font-bold text-slate-900">
          {bandLabel(bandId)}
          {subtitle ? ` · ${subtitle}` : ''}
        </h4>
        <p className="mt-1 text-xs text-slate-500">
          Schuljahr {plan.schoolYearStart}/{plan.schoolYearEnd} · T{plan.trimester}. Ein Haken setzt den Kurs in dieses Band und legt dafür eine eigene Variante an. Raum, Kapazität und welche Bänder sich eine Variante teilen, stehen im ganzen Trimester.
        </p>
      </div>
      {names.length === 0 ? (
        <p className="text-sm text-slate-500">Noch keine Werkstätten. Lege sie unter Werkstätten an.</p>
      ) : (
        <div className="space-y-2">
          {names.map(name => {
            const course = enriched.courses[name];
            const onThisBand = course?.enabled !== false && (course?.variants || []).some(item => item.bandIds?.includes(bandId));
            return (
              <div key={name} className={`rounded-xl border-2 px-4 py-3 ${onThisBand ? 'border-slate-400 bg-white' : 'border-slate-300 bg-slate-50'}`}>
                <label className="flex items-center gap-2 font-semibold text-slate-900">
                  <input
                    type="checkbox"
                    checked={onThisBand}
                    onChange={event => {
                      updateCourse(name, event.target.checked ? addBandAsOwn(course, bandId) : removeBandFromCourse(course, bandId));
                    }}
                  />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: workshopColors[name] || '#94a3b8' }} />
                  {name}
                </label>
                <p className="mt-1 pl-6 text-sm text-slate-600">{variantNote(course, bandId, onThisBand)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TrimesterManagementPanel({
  trimesterPlans,
  setTrimesterPlans,
  selectedKey,
  setSelectedKey,
  workshops,
  workshopColors,
  workshopTeachers,
  workshopRooms,
  klassenStufenPool,
  getWorkshopCapacity,
  getDefaultSchoolYear,
  updateWorkshopCapacity,
  updateWorkshopRoom,
  updateWorkshopTeacher,
  students,
  studentClasses,
  studentEnrollmentYears,
  rules,
  confirmedAssignments,
  ruleAppliesToStudent,
  ruleEnforcesNow,
  getRequiredFolgekurs,
  parseSchoolYearKey,
  loadChoicesForTrimesterKey,
  studentComments,
}) {
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [selectedBandId, setSelectedBandId] = useState(null);

  const workshopNames = useMemo(() => Object.keys(workshops).sort((a, b) => a.localeCompare(b, 'de')), [workshops]);
  const plansList = useMemo(() => Object.values(trimesterPlans), [trimesterPlans]);
  const plansChronological = useMemo(
    () =>
      [...plansList].sort((a, b) => {
        if (a.schoolYearStart !== b.schoolYearStart) return a.schoolYearStart - b.schoolYearStart;
        return a.trimester - b.trimester;
      }),
    [plansList]
  );

  const selectedPlan = selectedKey ? trimesterPlans[selectedKey] : null;
  const selectedBandStillThere = selectedPlan && selectedBandId && getPlanBandIds(selectedPlan).includes(selectedBandId);
  const activeBandId = selectedBandStillThere ? selectedBandId : null;

  const savePlan = useCallback(
    (plan) => {
      setTrimesterPlans(prev => ({ ...prev, [plan.key]: plan }));
    },
    [setTrimesterPlans]
  );

  const createAndSelectPlan = useCallback(
    (schoolYearStart, schoolYearEnd, trimester, bandCount = 2) => {
      const key = trimesterPlanKey(schoolYearStart, schoolYearEnd, trimester);
      if (trimesterPlans[key]) {
        setSelectedKey(key);
        return;
      }
      const plan = createTrimesterPlan({
        schoolYearStart,
        schoolYearEnd,
        trimester,
        bandCount,
        klassenStufenPool,
      });
      const withCourses = ensurePlanCourses(plan, workshopNames, getPlanBandIds(plan));
      setTrimesterPlans(prev => ({ ...prev, [plan.key]: withCourses }));
      setSelectedKey(plan.key);
    },
    [trimesterPlans, klassenStufenPool, workshopNames, setTrimesterPlans, setSelectedKey]
  );

  const addTrimester = () => {
    const def = getDefaultSchoolYear();
    let trimester = 1;
    const existing = Object.values(trimesterPlans).filter(
      p => p.schoolYearStart === def.schoolYearStart && p.schoolYearEnd === def.schoolYearEnd
    );
    if (existing.length) trimester = Math.min(3, Math.max(...existing.map(p => p.trimester)) + 1);
    createAndSelectPlan(def.schoolYearStart, def.schoolYearEnd, trimester);
  };

  const insertTrimesterAfter = useCallback(
    afterPlan => {
      if (!afterPlan) {
        const def = getDefaultSchoolYear();
        let trimester = 1;
        const existing = Object.values(trimesterPlans).filter(
          p => p.schoolYearStart === def.schoolYearStart && p.schoolYearEnd === def.schoolYearEnd
        );
        if (existing.length) trimester = Math.min(3, Math.max(...existing.map(p => p.trimester)) + 1);
        createAndSelectPlan(def.schoolYearStart, def.schoolYearEnd, trimester);
        return;
      }
      let { schoolYearStart, schoolYearEnd, trimester } = afterPlan;
      const bandCount = afterPlan.bandCount || 2;
      trimester += 1;
      if (trimester > 3) {
        schoolYearStart = schoolYearEnd;
        schoolYearEnd = schoolYearStart + 1;
        trimester = 1;
      }
      createAndSelectPlan(schoolYearStart, schoolYearEnd, trimester, bandCount);
    },
    [createAndSelectPlan, getDefaultSchoolYear, trimesterPlans]
  );

  const onApplyBlueprint = (workshopName, patch) => {
    if (patch.capacity != null) updateWorkshopCapacity(workshopName, patch.capacity);
    if (patch.room != null) updateWorkshopRoom(workshopName, patch.room);
    if (patch.teacher != null) updateWorkshopTeacher(workshopName, patch.teacher);
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-10rem)] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-teal-900">Trimester-Management</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Zeitstrahl der Trimester und Jahrgänge.
          </p>
        </div>
        <button
          type="button"
          onClick={addTrimester}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700"
        >
          + Neues Trimester
        </button>
      </div>

      <StudentFlowView
        embedMode
        plansChronological={plansChronological}
        students={students}
        studentClasses={studentClasses}
        studentEnrollmentYears={studentEnrollmentYears}
        studentComments={studentComments}
        confirmedAssignments={confirmedAssignments}
        loadChoicesForKey={loadChoicesForTrimesterKey}
        rules={rules}
        ruleAppliesToStudent={ruleAppliesToStudent}
        ruleEnforcesNow={ruleEnforcesNow}
        getRequiredFolgekurs={getRequiredFolgekurs}
        parseSchoolYearKey={parseSchoolYearKey}
        selectedPlanKey={selectedKey}
        selectedBand={activeBandId ? { planKey: selectedKey, bandId: activeBandId } : null}
        onSelectPlan={plan => {
          setSelectedKey(plan.key);
          setSelectedBandId(null);
        }}
        onSelectBand={(plan, bandId) => {
          setSelectedKey(plan.key);
          setSelectedBandId(current => (selectedKey === plan.key && current === bandId ? null : bandId));
        }}
        onInsertTrimesterAfter={insertTrimesterAfter}
        onMergeSelectionChange={setMergePanelOpen}
      />

      {!mergePanelOpen && selectedPlan && (
        <div className="flex-1 min-h-0 bg-slate-100 rounded-2xl border-2 border-slate-500 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b-2 border-teal-800 bg-teal-50 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-teal-900">
              {activeBandId ? `${bandLabel(activeBandId)} bearbeiten` : 'Trimester bearbeiten'}
            </h3>
            {activeBandId && (
              <button
                type="button"
                onClick={() => setSelectedBandId(null)}
                className="rounded-lg border-2 border-teal-800 bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-50"
              >
                Ganzes Trimester
              </button>
            )}
          </div>
          <div className="overflow-y-auto p-5 max-h-[min(52vh,720px)]">
            {activeBandId ? (
              <BandEditor
                plan={selectedPlan}
                bandId={activeBandId}
                workshopNames={workshopNames}
                workshopColors={workshopColors}
                onChange={savePlan}
              />
            ) : (
            <TrimesterEditor
              plan={selectedPlan}
              workshopNames={workshopNames}
              klassenStufenPool={klassenStufenPool}
              workshopColors={workshopColors}
              workshopTeachers={workshopTeachers}
              workshopRooms={workshopRooms}
              workshops={workshops}
              getWorkshopCapacity={getWorkshopCapacity}
              onChange={savePlan}
              onDelete={() => {
                if (!window.confirm('Dieses Trimester wirklich löschen? Die Wahl kann dann nicht mehr dafür gestartet werden.')) return;
                setTrimesterPlans(prev => {
                  const next = { ...prev };
                  delete next[selectedKey];
                  return next;
                });
                setSelectedKey(null);
              }}
              onApplyBlueprint={onApplyBlueprint}
            />
            )}
          </div>
        </div>
      )}

      {!mergePanelOpen && !selectedPlan && plansChronological.length === 0 && (
        <p className="text-sm text-gray-500 italic text-center py-8 border border-dashed rounded-xl">
          Noch kein Trimester. Mit „Neues Trimester“ oben rechts das erste anlegen.
        </p>
      )}

    </div>
  );
}
