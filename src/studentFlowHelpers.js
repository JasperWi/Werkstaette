import { getPlanBandIds, getTrimesterWahlCount, parseClassLetter, jahrgangColor, bandIdsInObject } from './trimesterPlans';

const ENTRY_STUFE = 5;
const TRIMESTERS_PER_YEAR = 3;
const ESTIMATED_BANDS_PER_JAHRGANG = 2;

function assignmentsUseBandMaps(assignments) {
  return bandIdsInObject(assignments).some(id => assignments[id] && typeof assignments[id] === 'object');
}

function isNotAssigned(val) {
  return !val || val === 'Nicht Zugeordnet' || String(val).trim() === '';
}

/**
 * Ob für ein Trimester bereits Wahl- und/oder Zuordnungsdaten existieren.
 * @returns {'planned'|'choices'|'assignments'|'both'}
 */
export function getTrimesterDataPhase(plan, confirmedAssignments, loadChoicesForKey) {
  if (!plan?.key) return 'planned';

  let hasAssignments = false;
  const payload = confirmedAssignments?.[plan.key];
  if (payload?.assignments && typeof payload.assignments === 'object') {
    const bandIds = getPlanBandIds(plan);
    const hasBandObjects = assignmentsUseBandMaps(payload.assignments);
    if (hasBandObjects) {
      hasAssignments = bandIds.some(bid => {
        const map = payload.assignments[bid];
        return map && Object.values(map).some(v => !isNotAssigned(v));
      });
    } else {
      hasAssignments = Object.values(payload.assignments).some(
        v => typeof v === 'string' && !isNotAssigned(v)
      );
    }
  }

  let hasChoices = false;
  const choices = loadChoicesForKey?.(plan.key);
  if (choices && typeof choices === 'object') {
    hasChoices = Object.values(choices).some(
      bandMap => bandMap && typeof bandMap === 'object' && Object.keys(bandMap).length > 0
    );
  }

  if (hasAssignments && hasChoices) return 'both';
  if (hasAssignments) return 'assignments';
  if (hasChoices) return 'choices';
  return 'planned';
}

export function isTrimesterPlannedOnly(plan, confirmedAssignments, loadChoicesForKey) {
  return getTrimesterDataPhase(plan, confirmedAssignments, loadChoicesForKey) === 'planned';
}

/**
 * Wahlstand eines einzelnen Bands. Bänder können unabhängig hochgeladen sein.
 * @returns {'planned'|'choices'|'assignments'|'both'}
 */
export function getBandDataPhase(plan, bandId, confirmedAssignments, loadChoicesForKey) {
  if (!plan?.key || !bandId) return 'planned';

  let hasAssignments = false;
  const payload = confirmedAssignments?.[plan.key];
  const bandMap = payload?.assignments?.[bandId];
  if (bandMap && typeof bandMap === 'object' && !Array.isArray(bandMap)) {
    hasAssignments = Object.values(bandMap).some(value => !isNotAssigned(value));
  } else if (payload?.assignments && typeof payload.assignments === 'object') {
    const hasBandObjects = assignmentsUseBandMaps(payload.assignments);
    if (!hasBandObjects) {
      hasAssignments = Object.values(payload.assignments).some(
        value => typeof value === 'string' && !isNotAssigned(value)
      );
    }
  }

  let hasChoices = false;
  const choices = loadChoicesForKey?.(plan.key);
  const bandChoices = choices?.[bandId];
  if (bandChoices && typeof bandChoices === 'object' && Object.keys(bandChoices).length > 0) {
    hasChoices = true;
  }

  if (hasAssignments && hasChoices) return 'both';
  if (hasAssignments) return 'assignments';
  if (hasChoices) return 'choices';
  return 'planned';
}

function getRuleKlassenStufenRange(rule) {
  if (rule?.klassenStufenRange?.from != null && rule?.klassenStufenRange?.to != null) {
    let from = Number(rule.klassenStufenRange.from);
    let to = Number(rule.klassenStufenRange.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }
  const raw = rule?.klassenStufen;
  if (!raw) return null;
  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map(v => parseInt(String(v).trim(), 10))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (list.length === 0) return null;
  return { from: list[0], to: list[list.length - 1] };
}

function comparePlansChronologically(a, b) {
  if (a.schoolYearStart !== b.schoolYearStart) return a.schoolYearStart - b.schoolYearStart;
  return (a.trimester || 0) - (b.trimester || 0);
}

function enrollmentMatchesRule(rule, enrollmentYear) {
  const fromRaw = rule?.einschulungsjahrFrom;
  const toRaw = rule?.einschulungsjahrTo;
  const from = fromRaw == null || fromRaw === '' ? null : Number(fromRaw);
  const to = toRaw == null || toRaw === '' ? null : Number(toRaw);
  const hasFrom = Number.isFinite(from);
  const hasTo = Number.isFinite(to);
  if (!hasFrom && !hasTo) return true;
  if (enrollmentYear == null) return false;
  if (hasFrom && Number(enrollmentYear) < from) return false;
  if (hasTo && Number(enrollmentYear) > to) return false;
  return true;
}

function coursesAssignedOnPlan(student, plan, confirmedAssignments) {
  const payload = confirmedAssignments?.[plan?.key];
  if (!payload?.assignments || !plan) return [];
  const bandIds = getPlanBandIds(plan);
  const names = [];
  const hasBandObjects = assignmentsUseBandMaps(payload.assignments);
  if (hasBandObjects) {
    bandIds.forEach(bandId => {
      const course = payload.assignments[bandId]?.[student];
      if (course && !isNotAssigned(course)) names.push(course);
    });
  } else {
    const course = payload.assignments[student];
    if (course && !isNotAssigned(course)) names.push(course);
  }
  return names;
}

function joinNames(list) {
  if (!list?.length) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} und ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`;
}

function openBandCount(student, plan, enrollmentYear, confirmedAssignments) {
  const stufe = getStufeAtSchoolYear(enrollmentYear, plan.schoolYearStart);
  const allowed = getAllowedBandIdsForStudent(plan, stufe);
  const assigned = getAssignedBandsForPlan(student, plan, confirmedAssignments);
  return allowed.filter(bid => !assigned[bid]).length;
}

function flattenWorkshopsFromAssignments(student, confirmedAssignments) {
  const workshops = [];
  Object.values(confirmedAssignments || {}).forEach(payload => {
    if (!payload?.assignments) return;
    const hasBandObjects = assignmentsUseBandMaps(payload.assignments);
    if (hasBandObjects) {
      bandIdsInObject(payload.assignments).forEach(bandId => {
        const course = payload.assignments[bandId]?.[student];
        if (course && !isNotAssigned(course)) workshops.push(course);
      });
    } else {
      const course = payload.assignments[student];
      if (course && !isNotAssigned(course)) workshops.push(course);
    }
  });
  return workshops;
}

function countDistinctFromOptions(historyFlat, options) {
  const allowed = new Set(options || []);
  const matched = new Set();
  historyFlat.forEach(w => {
    if (allowed.has(w)) matched.add(w);
  });
  return matched.size;
}

function listMissingFromOptions(historyFlat, options) {
  const done = new Set(historyFlat.filter(w => (options || []).includes(w)));
  return (options || []).filter(o => !done.has(o));
}

function getAssignedBandsForPlan(student, plan, confirmedAssignments) {
  const payload = confirmedAssignments?.[plan.key];
  const bandIds = getPlanBandIds(plan);
  if (!payload?.assignments) return {};
  const out = {};
  bandIds.forEach(bid => {
    const val = payload.assignments[bid]?.[student];
    out[bid] = !isNotAssigned(val);
  });
  return out;
}

function ruleTitle(rule) {
  const name = String(rule?.name || '').trim();
  if (name) return name;
  const type = rule?.type || 'belegung';
  if (type === 'folgekurs') return 'Folgekurs';
  if (type === 'mindestbelegung') return 'Mindestanzahl';
  return 'Alle Kurse';
}

/** A named „oder“ list is one choice among the courses, not every course. */
function ruleIsOrList(rule) {
  return /\boder\b/i.test(ruleTitle(rule));
}

function findPlanAt(sortedPlans, schoolYearStart, trimester) {
  return (
    sortedPlans.find(
      plan => Number(plan.schoolYearStart) === Number(schoolYearStart) && Number(plan.trimester) === Number(trimester)
    ) || null
  );
}

function assumptionNote(estimatedCount) {
  const shared = [
    'Zuordnungen ab dem gewählten Zeitpunkt gelten als noch nicht erfolgt.',
    'Freitext und Kommentare zählen nicht. Eine Oder-Liste zählt als eine Wahl, „n von diesen“ als so viele Wahlen, wie noch fehlen.',
  ];
  if (estimatedCount > 0) {
    const slots =
      estimatedCount === 1
        ? 'Für ein noch nicht angelegtes Trimester rechnen wir mit 2 Bändern für diesen Jahrgang.'
        : `Für ${estimatedCount} noch nicht angelegte Trimester rechnen wir mit 2 Bändern für diesen Jahrgang.`;
    return [
      slots,
      'Ein Schuljahr hat 3 Trimester. Gezählt wird bis zum Ende der Frist-Stufe, auch wenn diese Trimester noch nicht angelegt sind.',
      'Liegt ein Trimester schon als Plan vor, ersetzen die angehakten Bänder dieser Stufe die Schätzung. Kein Band heißt: dieses Trimester aussetzen.',
      ...shared,
    ].join(' ');
  }
  return [
    'Die offenen Wahlen folgen den geplanten Bändern dieses Jahrgangs bis zur Frist.',
    ...shared,
  ].join(' ');
}

function explainFreeChoices(deadlineStufe, slots, required, free, slotPlans, otherDeadlines) {
  const voteWord = slots === 1 ? 'Wahl' : 'Wahlen';
  const openBits = (slotPlans || []).filter(plan => plan.open > 0);
  const where = openBits.length
    ? ` (${openBits
        .map(plan => {
          const bandWord = plan.open === 1 ? 'Band' : 'Bänder';
          return `${plan.label}: ${plan.open} ${bandWord}${plan.estimated ? ', geschätzt' : ''}`;
        })
        .join(', ')})`
    : '';
  const openSentence = slots <= 0
    ? `Bis Stufe ${deadlineStufe} ist keine Wahl mehr offen.`
    : `Bis Stufe ${deadlineStufe} sind ${slots} ${voteWord} offen${where}.`;
  const fixed = required === 1
    ? '1 Kurs ist fest vorgeschrieben'
    : `${required} Kurse sind fest vorgeschrieben`;
  let because;
  if (free < 0 && slots <= 0) {
    because = `${fixed}, deshalb ist keine Wahl mehr frei.`;
  } else if (free < 0) {
    because = `${fixed}, aber nur ${slots} ${voteWord} sind noch offen.`;
  } else if (free === 0) {
    because = `${fixed}, deshalb bleibt keine freie Wahl.`;
  } else if (free === 1) {
    because = `${fixed}, deshalb bleibt 1 freie Wahl.`;
  } else {
    because = `${fixed}, deshalb bleiben ${free} freie Wahlen.`;
  }
  const tighter = otherDeadlines.length > 1
    ? ` Stufe ${deadlineStufe} ist die knappste dieser Fristen.`
    : '';
  return `${openSentence} ${because}${tighter}`;
}

function freeChoiceSentence(deadlineStufe, must, slots, free) {
  const till = `Bis Stufe ${deadlineStufe}`;
  if (free < 0) {
    if (slots <= 0) return `${till}: ${must}. Keine Wahl mehr bis dahin.`;
    const voteWord = slots === 1 ? 'Wahl' : 'Wahlen';
    return `${till}: ${must}. Nur ${slots} ${voteWord} bis dahin.`;
  }
  if (free === 0) return `${till}: ${must}. Keine freie Wahl bis dahin.`;
  if (free === 1) return `${till}: ${must}. 1 freie Wahl bis dahin.`;
  return `${till}: ${must}. ${free} freie Wahlen bis dahin.`;
}

/**
 * From the upcoming trimester on: what this student must still vote, and how many
 * course choices stay free until the tightest yearly deadline.
 * Freitext rules and personal comments are ignored.
 */
export function buildStudentVotingOutlook({
  student,
  enrollmentYear,
  anchorPlan,
  plansChronological,
  confirmedAssignments,
  rules,
}) {
  const none = { constrained: false, freeChoices: null, sentence: '' };
  const sortedPlans = [...(plansChronological || [])].sort(comparePlansChronologically);
  const anchorIdx = sortedPlans.findIndex(p => p.key === anchorPlan?.key);
  if (anchorIdx < 0 || !anchorPlan) return none;
  const futurePlans = sortedPlans
    .slice(anchorIdx)
    .filter(plan => jahrgangVotesAtPlan(enrollmentYear, plan).active);

  // Stand zum gewählten Zeitpunkt: Zuordnungen ab diesem Trimester gelten als noch nicht erfolgt.
  const knownAssignments = {};
  if (anchorIdx > 0) {
    sortedPlans.slice(0, anchorIdx).forEach(plan => {
      if (confirmedAssignments?.[plan.key]) knownAssignments[plan.key] = confirmedAssignments[plan.key];
    });
  }

  const historyFlat = flattenWorkshopsFromAssignments(student, knownAssignments);
  const anchorStufe = getStufeAtSchoolYear(enrollmentYear, anchorPlan.schoolYearStart);
  if (anchorStufe == null) return none;
  const demands = [];

  const rememberCourse = (course, deadlineStufe, source) => {
    if (!course || deadlineStufe == null) return;
    const existing = demands.find(item => item.course === course && !item.kind);
    if (!existing) {
      demands.push({ course, deadlineStufe, sources: source ? [source] : [] });
      return;
    }
    existing.deadlineStufe = Math.min(existing.deadlineStufe, deadlineStufe);
    if (
      source &&
      !existing.sources.some(item => item.ruleName === source.ruleName && item.kind === source.kind)
    ) {
      existing.sources.push(source);
    }
  };

  (rules || []).forEach(rule => {
    if (!enrollmentMatchesRule(rule, enrollmentYear)) return;
    const type = rule.type || 'belegung';
    if (type === 'freitext') return;
    const range = getRuleKlassenStufenRange(rule);
    const horizonSource = futurePlans.length ? futurePlans[futurePlans.length - 1] : anchorPlan;
    const horizon = getStufeAtSchoolYear(enrollmentYear, horizonSource.schoolYearStart);
    const deadlineStufe = range?.to ?? horizon;
    if (deadlineStufe == null || (anchorStufe != null && deadlineStufe < anchorStufe)) return;
    if (type === 'belegung') {
      const title = ruleTitle(rule);
      const options = rule.options || [];
      const missing = listMissingFromOptions(historyFlat, options);
      const orList = ruleIsOrList(rule) && options.length > 1;
      if (orList) {
        const satisfied = options.some(course => historyFlat.includes(course));
        if (!satisfied && missing.length > 1) {
          demands.push({
            kind: 'pick',
            mode: 'or',
            stillNeed: 1,
            pool: missing,
            deadlineStufe,
            ruleName: title,
          });
        } else if (!satisfied && missing.length === 1) {
          rememberCourse(missing[0], deadlineStufe, {
            ruleName: title,
            kind: 'belegung',
            text: `Muss bis Stufe ${deadlineStufe} belegt sein und fehlt noch.`,
          });
        }
      } else {
        missing.forEach(course =>
          rememberCourse(course, deadlineStufe, {
            ruleName: title,
            kind: 'belegung',
            text: `Muss bis Stufe ${deadlineStufe} belegt sein und fehlt noch.`,
          })
        );
      }
    } else if (type === 'mindestbelegung') {
      const missing = listMissingFromOptions(historyFlat, rule.options);
      const stillNeed = Math.min(
        missing.length,
        Math.max(0, (rule.minCount || 1) - countDistinctFromOptions(historyFlat, rule.options))
      );
      if (stillNeed <= 0) return;
      demands.push({
        kind: 'pick',
        stillNeed,
        pool: missing,
        deadlineStufe,
        ruleName: ruleTitle(rule),
      });
    }
  });

  futurePlans.forEach((plan, index) => {
    const prev = index === 0 ? sortedPlans[anchorIdx - 1] : futurePlans[index - 1];
    if (!prev) return;
    const stufe = getStufeAtSchoolYear(enrollmentYear, plan.schoolYearStart);
    if (stufe == null) return;
    const already = new Set(coursesAssignedOnPlan(student, plan, knownAssignments));
    const prevCourses = new Set(coursesAssignedOnPlan(student, prev, knownAssignments));
    (rules || []).forEach(rule => {
      if ((rule.type || 'belegung') !== 'folgekurs') return;
      if (!enrollmentMatchesRule(rule, enrollmentYear)) return;
      if (!rule.fromCourse || !rule.toCourse || !prevCourses.has(rule.fromCourse)) return;
      const range = getRuleKlassenStufenRange(rule);
      if (range && (stufe < range.from || stufe > range.to)) return;
      if (already.has(rule.toCourse)) return;
      const due = range?.to != null ? Math.min(range.to, stufe) : stufe;
      rememberCourse(rule.toCourse, due, {
        ruleName: ruleTitle(rule),
        kind: 'folgekurs',
        text: `Nach ${rule.fromCourse} vorgeschrieben und fehlt noch.`,
      });
    });
  });

  const deadlines = [...new Set(demands.map(item => item.deadlineStufe))].filter(stufe => stufe != null);
  if (deadlines.length === 0) return none;

  const projectSlots = deadlineStufe => {
    let year = Number(anchorPlan.schoolYearStart);
    let trimester = Number(anchorPlan.trimester) || 1;
    let slots = 0;
    let estimatedCount = 0;
    const slotPlans = [];
    for (let guard = 0; guard < 48; guard += 1) {
      const stufe = getStufeAtSchoolYear(enrollmentYear, year);
      if (stufe == null || stufe > deadlineStufe) break;
      const plan = findPlanAt(sortedPlans, year, trimester);
      const estimated = !plan;
      const open = plan
        ? openBandCount(student, plan, enrollmentYear, knownAssignments)
        : ESTIMATED_BANDS_PER_JAHRGANG;
      if (estimated) estimatedCount += 1;
      if (open > 0) {
        slotPlans.push({
          label: `T${trimester} ${year}/${year + 1}`,
          open,
          estimated,
        });
      }
      slots += open;
      trimester += 1;
      if (trimester > TRIMESTERS_PER_YEAR) {
        trimester = 1;
        year += 1;
      }
    }
    return { slots, slotPlans, estimatedCount };
  };

  const slotsUntil = deadlineStufe => projectSlots(deadlineStufe).slots;

  const requiredUntil = deadlineStufe => {
    const names = new Set(
      demands.filter(item => item.course && item.deadlineStufe <= deadlineStufe).map(item => item.course)
    );
    let extra = 0;
    demands.forEach(item => {
      if (item.kind !== 'pick' || item.deadlineStufe > deadlineStufe) return;
      const covered = item.pool.filter(course => names.has(course)).length;
      extra += Math.max(0, item.stillNeed - covered);
    });
    return names.size + extra;
  };

  let binding = null;
  const compared = [];
  deadlines.forEach(deadlineStufe => {
    const required = requiredUntil(deadlineStufe);
    if (required <= 0) return;
    const slots = slotsUntil(deadlineStufe);
    const free = slots - required;
    compared.push({ deadlineStufe, required, slots, free });
    if (
      !binding ||
      free < binding.free ||
      (free === binding.free && deadlineStufe < binding.deadlineStufe)
    ) {
      binding = { deadlineStufe, required, slots, free };
    }
  });
  if (!binding) return none;

  const courses = [
    ...new Set(
      demands
        .filter(item => item.course && item.deadlineStufe <= binding.deadlineStufe)
        .map(item => item.course)
    ),
  ];
  const nameSet = new Set(courses);
  const picks = [];
  const pickReasons = [];
  const choices = [];
  const mustAll = [...courses];
  const parts = [];
  if (courses.length) parts.push(joinNames(courses));
  demands.forEach(item => {
    if (item.kind !== 'pick' || item.deadlineStufe > binding.deadlineStufe) return;
    const covered = item.pool.filter(course => nameSet.has(course)).length;
    const still = Math.max(0, item.stillNeed - covered);
    if (still <= 0) return;
    const pool = item.pool.filter(course => !nameSet.has(course));
    if (pool.length === 0) return;
    const takesAll = still >= pool.length;
    const orList = !takesAll && (item.mode === 'or' || (still === 1 && pool.length > 1));
    const label = takesAll ? joinNames(pool) : orList ? pool.join(' oder ') : `${still} von ${pool.length}`;
    const text = takesAll
      ? `Jeder dieser Kurse muss bis Stufe ${item.deadlineStufe} gewählt werden.`
      : orList
        ? `Eines von diesen muss bis Stufe ${item.deadlineStufe} belegt sein und fehlt noch.`
        : `${still} von diesen ${pool.length} Kursen bis Stufe ${item.deadlineStufe}.`;
    if (takesAll) {
      pool.forEach(course => {
        if (!mustAll.includes(course)) mustAll.push(course);
      });
    } else {
      choices.push({ mode: orList ? 'or' : 'pick', count: still, options: pool });
    }
    picks.push(label);
    pickReasons.push({
      label,
      ruleName: item.ruleName,
      text,
      takesAll,
      mode: takesAll ? 'all' : orList ? 'or' : 'pick',
      count: still,
      options: pool,
    });
    parts.push(label);
  });
  if (parts.length === 0) return none;

  const courseReasons = demands
    .filter(item => item.course && courses.includes(item.course) && item.deadlineStufe <= binding.deadlineStufe)
    .flatMap(item =>
      (item.sources || []).map(source => ({
        course: item.course,
        ruleName: source.ruleName,
        text: source.text,
      }))
    );
  const projected = projectSlots(binding.deadlineStufe);
  const slotPlans = projected.slotPlans;

  const freeChoices = Math.max(0, binding.free);
  return {
    constrained: true,
    freeChoices,
    deadlineStufe: binding.deadlineStufe,
    courses,
    mustAll,
    choices,
    picks,
    courseReasons,
    pickReasons,
    slots: binding.slots,
    free: binding.free,
    assumptionNote: assumptionNote(projected.estimatedCount),
    freeExplanation: explainFreeChoices(
      binding.deadlineStufe,
      binding.slots,
      binding.required,
      binding.free,
      slotPlans,
      compared
    ),
    sentence: freeChoiceSentence(binding.deadlineStufe, parts.join(', '), binding.slots, binding.free),
  };
}

export function getStufeAtSchoolYear(enrollmentYear, schoolYearStart) {
  if (enrollmentYear == null || schoolYearStart == null) return null;
  return Number(schoolYearStart) - Number(enrollmentYear) + ENTRY_STUFE;
}

export function getAllowedBandIdsForStudent(plan, stufe) {
  if (stufe == null) return [];
  const access = plan?.stufenBandAccess;
  if (!access || typeof access !== 'object') return getPlanBandIds(plan);
  const bands = access[stufe] ?? access[String(stufe)];
  if (!Array.isArray(bands)) return getPlanBandIds(plan);
  return bands.filter(bandId => getPlanBandIds(plan).includes(bandId));
}

export function studentExistsInJahrgangAtPlan(student, enrollmentYear, plan, studentEnrollmentYears) {
  if (Number(studentEnrollmentYears[student]) !== Number(enrollmentYear)) return false;
  return jahrgangVotesAtPlan(enrollmentYear, plan).active;
}

export function jahrgangVotesAtPlan(enrollmentYear, plan) {
  const stufe = getStufeAtSchoolYear(enrollmentYear, plan.schoolYearStart);
  if (stufe == null) return { active: false, reason: 'unknown', stufe: null };
  const bands = getAllowedBandIdsForStudent(plan, stufe);
  if (!bands.length) return { active: false, reason: 'skip', stufe };
  return { active: true, stufe };
}

/** Stufe im gewählten Schuljahr. Ohne Einschulungsjahr zählt die Klassenstufe im Namen (z. B. 6b → 6). */
export function getStudentStufeForPlan(student, plan, studentEnrollmentYears, studentClasses) {
  const enrollment = Number(studentEnrollmentYears?.[student]);
  if (Number.isFinite(enrollment) && plan?.schoolYearStart != null) {
    return getStufeAtSchoolYear(enrollment, plan.schoolYearStart);
  }
  const match = String(studentClasses?.[student] || '').trim().match(/^(\d{1,2})/);
  return match ? parseInt(match[1], 10) : null;
}

/** Nur Schüler, deren Stufe in diesem Band wählen darf, werden für eine fehlende Wahl erwartet. */
export function isStudentExpectedToVoteOnBand(student, plan, bandId, studentEnrollmentYears, studentClasses) {
  const stufe = getStudentStufeForPlan(student, plan, studentEnrollmentYears, studentClasses);
  if (stufe == null) return false;
  return getAllowedBandIdsForStudent(plan, stufe).includes(bandId);
}

function isAssigned(val) {
  return val && val !== 'Nicht Zugeordnet' && String(val).trim() !== '';
}

export function getParticipationForStudent(student, plan, confirmedAssignments, choicesByBand) {
  const key = plan.key;
  const assignmentPayload = confirmedAssignments[key];
  const bandIds = getPlanBandIds(plan);
  const wahlCount = getTrimesterWahlCount(plan);

  const perBand = {};
  bandIds.forEach(bandId => {
    const assigned = assignmentPayload?.assignments?.[bandId]?.[student];
    const hasAssignment = isAssigned(assigned);
    const choiceList = choicesByBand?.[bandId]?.[student];
    const hasChoices = Array.isArray(choiceList) && choiceList.length > 0;
    perBand[bandId] = {
      hasAssignment,
      hasChoices,
      assigned: assigned || null,
      choices: choiceList || [],
    };
  });

  const anyActivity = bandIds.some(b => perBand[b].hasAssignment || perBand[b].hasChoices);
  return { perBand, bandIds, wahlCount, anyActivity };
}

export function getNodeStatusForJahrgang({
  enrollmentYear,
  plan,
  cohortStudents,
  studentClasses,
  confirmedAssignments,
  loadChoicesForKey,
}) {
  const vote = jahrgangVotesAtPlan(enrollmentYear, plan);
  if (!vote.active) {
    return {
      active: false,
      reason: vote.reason,
      total: cohortStudents.length,
      votedCount: 0,
      partialCount: 0,
      noVoteCount: 0,
      bandStats: {},
      summary: 'Nimmt an dieser Wahl nicht teil.',
    };
  }

  const choicesRaw = loadChoicesForKey?.(plan.key) || null;
  const bandIds = getPlanBandIds(plan);
  const bandStats = {};
  bandIds.forEach(bid => {
    bandStats[bid] = { allowed: 0, executed: 0, pending: 0, missing: 0, noAccess: 0 };
  });

  let votedCount = 0;
  let partialCount = 0;
  let noVoteCount = 0;

  cohortStudents.forEach(student => {
    const stufe = getStufeAtSchoolYear(enrollmentYear, plan.schoolYearStart);
    const allowedBands = getAllowedBandIdsForStudent(plan, stufe);
    const part = getParticipationForStudent(student, plan, confirmedAssignments, choicesRaw);

    let bandsExpected = 0;

    bandIds.forEach(bid => {
      const canUseBand = allowedBands.includes(bid);
      if (!canUseBand) {
        bandStats[bid].noAccess += 1;
        return;
      }
      bandsExpected += 1;
      bandStats[bid].allowed += 1;
      const pb = part.perBand[bid];
      if (pb.hasAssignment) {
        bandStats[bid].executed += 1;
      } else if (pb.hasChoices) {
        bandStats[bid].pending += 1;
      } else {
        bandStats[bid].missing += 1;
      }
    });

    const bandsAssigned = allowedBands.filter(bid => part.perBand[bid]?.hasAssignment).length;
    const hasAnyChoices = allowedBands.some(bid => part.perBand[bid]?.hasChoices);
    if (bandsExpected === 0) noVoteCount += 1;
    else if (bandsAssigned === bandsExpected) votedCount += 1;
    else if (bandsAssigned > 0 || hasAnyChoices) partialCount += 1;
    else noVoteCount += 1;
  });

  return {
    active: true,
    stufe: vote.stufe,
    total: cohortStudents.length,
    votedCount,
    partialCount,
    noVoteCount,
    bandStats,
    summary: `${cohortStudents.length} Schüler · Stufe ~${vote.stufe} · ${votedCount} vollständig · ${partialCount} teilweise · ${noVoteCount} ohne Wahl`,
  };
}

/** Aggregate visual state for one band column in Schülerfluss. */
export function getBandAggregateState(bandStat, cohortActive) {
  if (!cohortActive) return 'inactive';
  if (!bandStat || bandStat.allowed === 0) return 'noAccess';
  const { allowed, executed, pending, missing } = bandStat;
  if (executed >= allowed) return 'executed';
  if (pending > 0 && executed === 0 && missing === 0) return 'pending';
  if (pending > 0) return 'mixed';
  if (missing > 0) return 'missing';
  return 'executed';
}

export function buildStudentFlowDetail({
  enrollmentYear,
  plan,
  plansChronological,
  students,
  studentEnrollmentYears,
  studentClasses,
  confirmedAssignments,
  rules,
}) {
  const cohortStudents = students.filter(s => Number(studentEnrollmentYears[s]) === Number(enrollmentYear));

  return cohortStudents
    .map(student => {
      const outlook = buildStudentVotingOutlook({
        student,
        enrollmentYear,
        anchorPlan: plan,
        plansChronological,
        confirmedAssignments,
        rules,
      });
      if (!outlook.constrained) return null;
      return {
        student,
        className: studentClasses[student] || '',
        outlook,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.outlook.freeChoices - b.outlook.freeChoices || a.student.localeCompare(b.student, 'de')
    );
}

export function classLetterShape(letter) {
  switch (letter) {
    case 'a': return 'circle';
    case 'b': return 'rect';
    case 'c': return 'triangle';
    default: return 'diamond';
  }
}

export function renderShape(type, cx, cy, r, fill) {
  if (type === 'circle') return { type: 'circle', cx, cy, r, fill };
  if (type === 'rect') return { type: 'rect', x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill };
  if (type === 'triangle') {
    const d = `M ${cx} ${cy - r} L ${cx + r} ${cy + r} L ${cx - r} ${cy + r} Z`;
    return { type: 'path', d, fill };
  }
  const d = `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
  return { type: 'path', d, fill };
}

export { jahrgangColor, parseClassLetter, getPlanBandIds };
