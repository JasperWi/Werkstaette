/** Trimester plan definitions — must exist before running Wahl for that period. */

export function trimesterPlanKey(schoolYearStart, schoolYearEnd, trimester) {
  return `${schoolYearStart}-${schoolYearEnd} T${trimester}`;
}

export function createCourseVariant(bandIds = [], overrides = {}) {
  return {
    id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bandIds: [...bandIds],
    capacity: overrides.capacity ?? null,
    room: overrides.room ?? null,
    teacher: overrides.teacher ?? null,
    color: overrides.color ?? null,
  };
}

export function createDefaultCourseEntry(bandIds) {
  return {
    enabled: true,
    variants: [createCourseVariant(bandIds)],
  };
}

export const DEFAULT_WAHL_COUNT = 2;
export const MIN_WAHL_COUNT = 1;
export const MAX_WAHL_COUNT = 5;

export function clampWahlCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WAHL_COUNT;
  return Math.min(MAX_WAHL_COUNT, Math.max(MIN_WAHL_COUNT, Math.round(n)));
}

export function getTrimesterWahlCount(plan) {
  return clampWahlCount(plan?.wahlCount ?? DEFAULT_WAHL_COUNT);
}

const NAMED_BAND_IDS = ['erstesBand', 'zweitesBand', 'drittesBand', 'viertesBand', 'fuenftesBand', 'sechstesBand'];
export const MAX_BAND_COUNT = 30;

export function bandNumberFromId(bandId) {
  const named = NAMED_BAND_IDS.indexOf(bandId);
  if (named >= 0) return named + 1;
  const match = String(bandId || '').match(/^band(\d+)$/);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 ? number : null;
}

export function isBandId(bandId) {
  return bandNumberFromId(bandId) != null;
}

export function bandIdForNumber(number) {
  const n = Number(number);
  if (n >= 1 && n <= NAMED_BAND_IDS.length) return NAMED_BAND_IDS[n - 1];
  return `band${n}`;
}

export function clampBandCount(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n)) return 2;
  return Math.min(MAX_BAND_COUNT, Math.max(1, n));
}

export function bandIdsForCount(count) {
  const n = clampBandCount(count);
  return Array.from({ length: n }, (_, index) => bandIdForNumber(index + 1));
}

export function bandShortLabel(bandId) {
  const number = bandNumberFromId(bandId);
  return number ? `${number}. Band` : String(bandId || 'Band');
}

export function bandIdsInObject(data) {
  return Object.keys(data || {})
    .filter(isBandId)
    .sort((a, b) => bandNumberFromId(a) - bandNumberFromId(b));
}

export function createTrimesterPlan({ schoolYearStart, schoolYearEnd, trimester, bandCount = 2, klassenStufenPool = [] }) {
  const bandIds = bandIdsForCount(bandCount);
  const stufenBandAccess = {};
  klassenStufenPool.forEach(stufe => {
    stufenBandAccess[stufe] = [...bandIds];
  });
  return {
    key: trimesterPlanKey(schoolYearStart, schoolYearEnd, trimester),
    schoolYearStart,
    schoolYearEnd,
    trimester,
    bandCount: bandIds.length,
    wahlCount: DEFAULT_WAHL_COUNT,
    bandSubtitles: {},
    stufenBandAccess,
    courses: {},
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeTrimesterPlans(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.entries(raw).forEach(([key, plan]) => {
    if (!plan || typeof plan !== 'object') return;
    const k = plan.key || key;
    out[k] = {
      ...plan,
      key: k,
      courses: plan.courses && typeof plan.courses === 'object' ? plan.courses : {},
      bandSubtitles: plan.bandSubtitles || {},
      stufenBandAccess: plan.stufenBandAccess || {},
      wahlCount: clampWahlCount(plan.wahlCount),
    };
  });
  return out;
}

export function plansAsSortedList(plansMap) {
  return Object.values(plansMap).sort(compareTrimesterPlans);
}

export function compareTrimesterPlans(a, b) {
  if (a.schoolYearStart !== b.schoolYearStart) return b.schoolYearStart - a.schoolYearStart;
  if (a.trimester !== b.trimester) return b.trimester - a.trimester;
  return 0;
}

export function groupPlansBySchoolYear(plansMap) {
  const groups = new Map();
  plansAsSortedList(plansMap).forEach(plan => {
    const label = `${plan.schoolYearStart}–${plan.schoolYearEnd}`;
    if (!groups.has(label)) groups.set(label, { label, start: plan.schoolYearStart, end: plan.schoolYearEnd, plans: [] });
    groups.get(label).plans.push(plan);
  });
  return [...groups.values()].sort((a, b) => b.start - a.start);
}

export function getPlanBandIds(plan) {
  return bandIdsForCount(plan?.bandCount || 2);
}

function keepCourseVariants(entry, fallbackBandIds) {
  const variants = (entry?.variants || []).filter(variant => variant && typeof variant === 'object');
  if (!variants.length) return [createCourseVariant(fallbackBandIds)];
  return variants.map((variant, index) => ({
    id: variant.id || `v_${index}_${(variant.bandIds || []).join('_')}`,
    bandIds: (variant.bandIds || []).filter(id => fallbackBandIds.includes(id)),
    capacity: variant.capacity ?? null,
    room: variant.room ?? null,
    teacher: variant.teacher ?? null,
    color: variant.color ?? null,
  }));
}

export function ensurePlanCourses(plan, workshopNames, bandIds) {
  const courses = { ...(plan.courses || {}) };
  workshopNames.forEach(name => {
    if (!courses[name]) {
      courses[name] = createDefaultCourseEntry(bandIds);
      return;
    }
    courses[name] = {
      enabled: courses[name].enabled !== false,
      variants: keepCourseVariants(courses[name], bandIds),
    };
  });
  return { ...plan, courses };
}

export function getCourseVariantForBand(courseEntry, bandId) {
  if (!courseEntry?.enabled) return null;
  const variants = courseEntry.variants || [];
  return variants.find(v => v.bandIds?.includes(bandId)) || variants[0] || null;
}

export function resolveTrimesterWorkshopMeta(
  plan,
  workshopName,
  bandId,
  { workshops, workshopTeachers, workshopRooms, workshopColors, getWorkshopCapacity }
) {
  const entry = plan?.courses?.[workshopName];
  const variant = entry ? getCourseVariantForBand(entry, bandId) : null;
  const baseCap = getWorkshopCapacity(workshops[workshopName], workshopName);
  return {
    enabled: entry?.enabled !== false,
    capacity: variant?.capacity != null && variant.capacity !== '' ? Number(variant.capacity) : baseCap,
    room: variant?.room != null && String(variant.room).trim() !== '' ? variant.room : (workshopRooms[workshopName] || ''),
    teacher: variant?.teacher != null && String(variant.teacher).trim() !== '' ? variant.teacher : (workshopTeachers[workshopName] || ''),
    color: variant?.color || workshopColors[workshopName] || null,
  };
}

export function isWorkshopOfferedInBand(plan, workshopName, bandId) {
  const entry = plan?.courses?.[workshopName];
  if (!entry?.enabled) return false;
  const variants = entry.variants || [];
  if (variants.length === 0) return true;
  return variants.some(v => v.bandIds?.includes(bandId));
}

export function parseClassLetter(className) {
  if (!className) return '?';
  const m = String(className).trim().match(/^\d{1,2}([a-zA-ZäöüÄÖÜ])/);
  return m ? m[1].toLowerCase() : '?';
}

export function jahrgangColor(enrollmentYear) {
  const palette = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#4f46e5'];
  if (enrollmentYear == null) return '#94a3b8';
  const idx = Math.abs(Number(enrollmentYear)) % palette.length;
  return palette[idx];
}

/** Rough rule-progress snapshot for Jahrgang hover (uses caller-supplied rule helpers). */
export function computeJahrgangTrimesterStats({
  enrollmentYear,
  trimesterKey,
  students,
  studentEnrollmentYears,
  studentClasses,
  rules,
  confirmedAssignments,
  ruleAppliesToStudent,
  ruleEnforcesNow,
  getRequiredFolgekurs,
  parseSchoolYearKey,
  workshops,
}) {
  const cohortStudents = students.filter(
    s => Number(studentEnrollmentYears[s]) === Number(enrollmentYear)
  );
  if (cohortStudents.length === 0) {
    return { count: 0, activeRules: 0, atRisk: [], fulfilledPct: 0, summary: 'Keine Schüler in diesem Jahrgang.' };
  }

  const parsed = parseSchoolYearKey(trimesterKey);
  const atRisk = [];
  let fulfilled = 0;

  cohortStudents.forEach(student => {
    const applicable = (rules || []).filter(r =>
      ruleAppliesToStudent(r, student, studentClasses, studentEnrollmentYears)
    );
    const enforcing = applicable.filter(r =>
      ruleEnforcesNow(r, student, studentClasses, studentEnrollmentYears)
    );
    let studentOk = true;
    enforcing.forEach(rule => {
      const type = rule.type || 'belegung';
      if (type === 'folgekurs' && parsed) {
        const bands = ['erstesBand', 'zweitesBand'];
        const required = getRequiredFolgekurs(
          student,
          rules,
          confirmedAssignments,
          parsed.schoolYearStart,
          parsed.schoolYearEnd,
          parsed.trimester,
          bands[0],
          studentClasses,
          studentEnrollmentYears
        );
        if (required && required !== '—') {
          studentOk = false;
        }
      }
    });

    if (studentOk && enforcing.length > 0) fulfilled += 1;
    if (!studentOk) atRisk.push(student);
  });

  const withRules = cohortStudents.filter(s =>
    (rules || []).some(r => ruleEnforcesNow(r, s, studentClasses, studentEnrollmentYears))
  ).length;

  const fulfilledPct = withRules > 0 ? Math.round((fulfilled / withRules) * 100) : 100;

  return {
    count: cohortStudents.length,
    activeRules: rules?.length || 0,
    atRisk: atRisk.slice(0, 8),
    fulfilledPct,
    workshopCount: Object.keys(workshops || {}).length,
    summary: `${cohortStudents.length} Schüler · ${fulfilledPct}% mit aktuell erfüllten Pflicht-Regeln`,
  };
}

/** Parse assignment/choices slot keys (new and legacy `YYYY-T#`). */
export function parseTrimesterSlotKey(key) {
  if (!key) return null;
  const newFormat = String(key).match(/(\d+)-(\d+)\s+T(\d+)/);
  if (newFormat) {
    const schoolYearStart = parseInt(newFormat[1], 10);
    const schoolYearEnd = parseInt(newFormat[2], 10);
    const trimester = parseInt(newFormat[3], 10);
    return {
      schoolYearStart,
      schoolYearEnd,
      trimester,
      canonicalKey: trimesterPlanKey(schoolYearStart, schoolYearEnd, trimester),
      rawKey: key,
    };
  }
  const oldFormat = String(key).match(/^(\d+)-T(\d+)$/);
  if (oldFormat) {
    const schoolYearStart = parseInt(oldFormat[1], 10);
    const schoolYearEnd = schoolYearStart + 1;
    const trimester = parseInt(oldFormat[2], 10);
    return {
      schoolYearStart,
      schoolYearEnd,
      trimester,
      canonicalKey: trimesterPlanKey(schoolYearStart, schoolYearEnd, trimester),
      rawKey: key,
    };
  }
  return null;
}

export function inferBandCountFromAssignmentPayload(payload) {
  const listed = (payload?.bands || []).map(bandNumberFromId).filter(number => number != null);
  if (listed.length) return clampBandCount(Math.max(...listed));
  const present = bandIdsInObject(payload?.assignments).map(bandNumberFromId);
  if (!present.length) return 2;
  return clampBandCount(Math.max(...present));
}

export function inferWahlCountFromChoices(choicesByBand) {
  let max = DEFAULT_WAHL_COUNT;
  if (!choicesByBand || typeof choicesByBand !== 'object') return max;
  Object.values(choicesByBand).forEach(bandMap => {
    Object.values(bandMap || {}).forEach(ch => {
      if (Array.isArray(ch)) max = Math.max(max, ch.filter(Boolean).length);
    });
  });
  return clampWahlCount(max);
}

function payloadForSlot(confirmedAssignments, slot) {
  if (!confirmedAssignments) return null;
  return confirmedAssignments[slot.canonicalKey] || confirmedAssignments[slot.rawKey] || null;
}

function choicesForSlot(choicesBySlotKey, slot) {
  if (!choicesBySlotKey) return null;
  return choicesBySlotKey[slot.canonicalKey] || choicesBySlotKey[slot.rawKey] || null;
}

function mergeExplicitWithInferred(explicit, inferred) {
  const explicitCourses = explicit.courses && typeof explicit.courses === 'object' ? explicit.courses : {};
  const inferredCourses = inferred.courses && typeof inferred.courses === 'object' ? inferred.courses : {};
  const hasExplicitCourses = Object.keys(explicitCourses).length > 0;
  const explicitAccess = explicit.stufenBandAccess && typeof explicit.stufenBandAccess === 'object' ? explicit.stufenBandAccess : {};
  return {
    ...inferred,
    ...explicit,
    key: explicit.key || inferred.key,
    bandCount: Math.max(explicit.bandCount || 0, inferred.bandCount || 2),
    wahlCount: clampWahlCount(Math.max(getTrimesterWahlCount(explicit), getTrimesterWahlCount(inferred))),
    courses: hasExplicitCourses ? explicitCourses : inferredCourses,
    stufenBandAccess:
      Object.keys(explicitAccess).length > 0 ? explicitAccess : inferred.stufenBandAccess || {},
    bandSubtitles: { ...(inferred.bandSubtitles || {}), ...(explicit.bandSubtitles || {}) },
    notes: explicit.notes || inferred.notes || '',
    updatedAt: explicit.updatedAt || new Date().toISOString(),
    createdAt: explicit.createdAt || inferred.createdAt,
  };
}

/**
 * Build or complete trimester plans from ZIP/local data.
 * Explicit trimester-plans.json wins for user edits; gaps filled from assignments + choices.
 */
export function buildInferredTrimesterPlans({
  confirmedAssignments = {},
  choicesBySlotKey = {},
  klassenStufenPool = [],
  workshopNames = [],
  existingPlans = {},
}) {
  const slotKeys = new Set();
  Object.keys(confirmedAssignments || {}).forEach(k => {
    const s = parseTrimesterSlotKey(k);
    if (s) slotKeys.add(s.canonicalKey);
  });
  Object.keys(choicesBySlotKey || {}).forEach(k => {
    const s = parseTrimesterSlotKey(k);
    if (s) slotKeys.add(s.canonicalKey);
  });
  Object.keys(normalizeTrimesterPlans(existingPlans)).forEach(k => slotKeys.add(k));

  const out = {};
  slotKeys.forEach(canonicalKey => {
    const slot = parseTrimesterSlotKey(canonicalKey);
    if (!slot) return;

    const payload = payloadForSlot(confirmedAssignments, slot);
    const choices = choicesForSlot(choicesBySlotKey, slot);
    const bandCount = inferBandCountFromAssignmentPayload(payload);
    const wahlCount = inferWahlCountFromChoices(choices);

    let inferred = createTrimesterPlan({
      schoolYearStart: slot.schoolYearStart,
      schoolYearEnd: slot.schoolYearEnd,
      trimester: slot.trimester,
      bandCount,
      klassenStufenPool,
    });
    inferred.wahlCount = wahlCount;
    if (!payload && choices) {
      inferred.notes = inferred.notes || 'Aus Wahl-Upload abgeleitet (keine Zuordnung im Import)';
    } else if (!existingPlans?.[canonicalKey]) {
      inferred.notes = inferred.notes || 'Automatisch aus Import-Historie abgeleitet';
    }
    if (workshopNames?.length) {
      inferred = ensurePlanCourses(inferred, workshopNames, getPlanBandIds(inferred));
    }

    const explicit = normalizeTrimesterPlans(existingPlans)[canonicalKey];
    out[canonicalKey] = explicit ? mergeExplicitWithInferred(explicit, inferred) : inferred;
  });

  return normalizeTrimesterPlans(out);
}

/** @deprecated use buildInferredTrimesterPlans */
export function migratePlansFromAssignmentKeys(confirmedAssignments, klassenStufenPool) {
  return buildInferredTrimesterPlans({
    confirmedAssignments,
    klassenStufenPool,
    existingPlans: {},
  });
}
