/**
 * Generates werkstatt-demo.zip with ~60 students (3×20 Jahrgänge),
 * 5 trimesters of Zuordnungs-Historie + 6th upcoming (Plan only, keine Wahl-CSVs).
 *
 * Usage: node scripts/generate-demo-zip.js
 * Output: scripts/output/werkstatt-demo.zip
 *
 * Wahl-Daten werden bewusst nicht ins Demo-ZIP gepackt — Upload erfolgt in der App wie im echten Betrieb.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const SEP = ';';
const OUT_DIR = path.join(__dirname, 'output');

const BAND_IDS = ['erstesBand', 'zweitesBand', 'drittesBand', 'viertesBand', 'fuenftesBand', 'sechstesBand'];
const BAND_HEADERS = ['ErstesBand', 'ZweitesBand', 'DrittesBand', 'ViertesBand', 'FuenftesBand', 'SechstesBand'];

const TRIMESTERS = [
  { syStart: 2024, syEnd: 2025, t: 1 },
  { syStart: 2024, syEnd: 2025, t: 2 },
  { syStart: 2024, syEnd: 2025, t: 3 },
  { syStart: 2025, syEnd: 2026, t: 1 },
  { syStart: 2025, syEnd: 2026, t: 2 },
  { syStart: 2025, syEnd: 2026, t: 3 },
];

function slotKey({ syStart, syEnd, t }) {
  return `${syStart}-${syEnd} T${t}`;
}

function csvEscape(cell) {
  const cellStr = String(cell ?? '');
  if (cellStr.includes(SEP) || cellStr.includes('"') || cellStr.includes('\n')) {
    return `"${cellStr.replace(/"/g, '""')}"`;
  }
  return cellStr;
}

function toCsv(rows) {
  const BOM = '\uFEFF';
  const body = rows.map(row => row.map(csvEscape).join(SEP)).join('\r\n');
  return BOM + body;
}

function pick(arr, i) {
  return arr[i % arr.length];
}

function voteSeed(name, trimesterIndex, bandIndex) {
  let hash = trimesterIndex * 17 + bandIndex * 5 + 11;
  const text = String(name || '');
  for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return hash;
}

// --- Workshops ---
const WORKSHOPS = {
  'Holzwerkstatt': { capacity: 8, bands: BAND_IDS },
  'Textil & Nähen': { capacity: 10, bands: BAND_IDS },
  'Küche & Backstube': { capacity: 10, bands: BAND_IDS },
  'Film & Medien': { capacity: 6, bands: BAND_IDS },
  'Robotik Lab': { capacity: 8, bands: BAND_IDS },
  'Theater & Bühne': { capacity: 12, bands: BAND_IDS },
  'Garten & Natur': { capacity: 14, bands: BAND_IDS },
  'Druck & Grafik': { capacity: 8, bands: BAND_IDS },
  'Film Grundlagen': { capacity: 10, bands: BAND_IDS },
  'Film Vertiefung': { capacity: 8, bands: BAND_IDS },
  'Möbelbau': { capacity: 6, bands: BAND_IDS },
};

const WORKSHOP_COLORS = {
  'Holzwerkstatt': '#8B4513',
  'Textil & Nähen': '#E91E63',
  'Küche & Backstube': '#FF9800',
  'Film & Medien': '#673AB7',
  'Robotik Lab': '#2196F3',
  'Theater & Bühne': '#F44336',
  'Garten & Natur': '#4CAF50',
  'Druck & Grafik': '#795548',
  'Film Grundlagen': '#9C27B0',
  'Film Vertiefung': '#3F51B5',
  'Möbelbau': '#607D8B',
};

const TEACHERS = {
  'Holzwerkstatt': 'Meister Hansen',
  'Textil & Nähen': 'Fr. Schneider',
  'Küche & Backstube': 'Herr Krümel',
  'Film & Medien': 'Fr. Kamera',
  'Robotik Lab': 'Dr. Servo',
  'Theater & Bühne': 'Herr Dramaturg',
  'Garten & Natur': 'Fr. Gießkanne',
  'Druck & Grafik': 'Herr Raster',
  'Film Grundlagen': 'Fr. Kamera',
  'Film Vertiefung': 'Herr Schnitt',
  'Möbelbau': 'Meister Hansen',
};

const ROOMS = {
  'Holzwerkstatt': 'Werk-H1',
  'Textil & Nähen': 'NäH-2',
  'Küche & Backstube': 'Küche A',
  'Film & Medien': 'Studio 9 (begehrt!)',
  'Robotik Lab': 'MINT-404',
  'Theater & Bühne': 'Aula-Bühne',
  'Garten & Natur': 'Schulgarten',
  'Druck & Grafik': 'Druck-1',
  'Film Grundlagen': 'Studio 7',
  'Film Vertiefung': 'Studio 9',
  'Möbelbau': 'Werk-H2',
};

const PREREQS = {
  'Möbelbau': ['Holzwerkstatt'],
  'Film Vertiefung': ['Film Grundlagen'],
  'Robotik Lab': ['Druck & Grafik'],
};

const NO_PARALLEL = {
  'Film & Medien': ['Theater & Bühne'],
  'Theater & Bühne': ['Film & Medien'],
};

// --- Students: 3 cohorts × 20 ---
const FIRST = [
  'Lina', 'Finn', 'Maja', 'Ben', 'Nora', 'Elias', 'Zoe', 'Paul', 'Mila', 'Noah',
  'Hannah', 'Leo', 'Emma', 'Luis', 'Clara', 'Jonas', 'Sophie', 'Max', 'Amelie', 'Tim',
];
const LAST = [
  'Müller', 'Schmidt', 'Weber', 'Fischer', 'Becker', 'Wagner', 'Hoffmann', 'Koch', 'Richter', 'Klein',
  'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Krüger', 'Lange', 'Schmitt', 'Meier', 'Lehmann',
];
const FUNNY = [
  'Hat mir geschrieben, dass die Filmwerkstatt „Lebenssinn“ ist.',
  'Eltern bestehen auf Küche — Kind besteht auf Robotik. Familienrat seit 3 Wochen.',
  '„Nur wenn es nicht nach Sägen riecht.“ (Holzwerkstatt trotzdem Wahl 1)',
  'Bringt eigenen Schutzhelm mit. Nicht sicher warum.',
  'Will unbedingt Möbelbau, hat Holz aber nur 1× — Regel-Drama incoming.',
  'Behauptet, Garten sei „Offline TikTok“.',
  'Assistenz: ja. Kommt mit Quietsche-Ente zur Beruhigung.',
  'Hat letztes Trimester Theater gewählt und nur gegähnt. Lehrerin ist informiert.',
  '„Drittwahl ist immer Küche“ — steht in der Bio.',
  'Bleibt sitzen in 6b (Wiederholung). Peers sind schon in 7a — traurig aber dokumentiert.',
  'Priority-Score absichtlich niedrig — „will anderen die Chance geben“ (Zynikerin, 12 J.)',
  'Wahl 1 und 2 identisch gesetzt „für den Fall der Fälle“.',
  'Fragt wöchentlich, ob Möbelbau ein echter Beruf ist.',
  'Unicorn-Ordner. Enthält nur Zeichnungen von Roboter-Katzen.',
  'Extrem höflich in E-Mails, im Chat nur Capslock.',
  'Will Film, ist aber in Theater gelandet — weint nicht, filmt heimlich.',
  'Hat Voraussetzung Druck verpasst, wählt trotzdem Robotik. Chaos.',
  'Eltern: „Bitte etwas mit Mathe.“ Kind: Garten.',
  'Bekannter Kapazitäts-Killer: wählt immer Film & Medien mit 47 anderen.',
  'Notiz an sich selbst: „Nächstes Jahr ernst nehmen.“ (steht seit 2 Jahren da)',
];

/** Klassenstufe beim Start der Demo (2024/25 T1). JG-2025 erscheint erst ab 2025/26 T1. */
const COHORTS = [
  { label: 'JG-2023', baseStufeAtStart: 6, firstTrimesterIndex: 0 },
  { label: 'JG-2024', baseStufeAtStart: 5, firstTrimesterIndex: 0 },
  { label: 'JG-2025', baseStufeAtStart: 5, firstTrimesterIndex: 3 },
];
const ENTRY_STUFE = 5;
const repeatStudent = 'Maja Becker';

function parseKlassenStufe(className) {
  const m = String(className || '').trim().match(/^(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}

/** Wie in der App: Schuljahresstart − (Stufe − 5) beim ersten Wahl-Upload. */
function inferEinschulungsjahrFromWahlClass(schoolYearStart, className) {
  const stufe = parseKlassenStufe(className);
  if (stufe == null) return null;
  const yearsSinceEntry = stufe - ENTRY_STUFE;
  if (yearsSinceEntry < 0) return null;
  return schoolYearStart - yearsSinceEntry;
}

function classForStudent(cohort, studentIndex, trimesterIndex, name) {
  const letter = studentIndex < 10 ? 'a' : 'b';
  const schoolYearIndex = Math.floor(trimesterIndex / 3);
  let stufe = cohort.baseStufeAtStart + schoolYearIndex;
  if (name === repeatStudent && trimesterIndex >= 3) {
    stufe -= 1;
  }
  return `${stufe}${letter}`;
}

const students = [];
const studentMeta = {};
const studentEnrollmentYears = {};
const studentClasses = {};
const studentComments = {};
const studentAssistants = {};
const studentPriorityScores = {};

function stufeForStudentAtTrimester(name, tIdx) {
  const meta = studentMeta[name];
  if (!meta) return null;
  const schoolYearIndex = Math.floor(tIdx / 3);
  let stufe = meta.cohort.baseStufeAtStart + schoolYearIndex;
  if (name === repeatStudent && tIdx >= 3) stufe -= 1;
  return stufe;
}

function studentVotesAtTrimester(name, tIdx) {
  const meta = studentMeta[name];
  if (!meta || tIdx < meta.cohort.firstTrimesterIndex) return false;
  const stufe = stufeForStudentAtTrimester(name, tIdx);
  if (stufe == null) return false;
  const access = buildStufenBandAccess(BAND_IDS.slice(0, demoBandCountForTrimester(tIdx)));
  return (access[stufe] || []).length > 0;
}

function studentsForTrimester(tIdx) {
  return students.filter(s => studentVotesAtTrimester(s, tIdx));
}

COHORTS.forEach((cohort, ci) => {
  for (let i = 0; i < 20; i++) {
    const name = `${pick(FIRST, ci * 7 + i)} ${pick(LAST, ci * 11 + i)}`;
    students.push(name);
    studentMeta[name] = { cohort, studentIndex: i };
    const classAtFirstWahl = classForStudent(cohort, i, cohort.firstTrimesterIndex, name);
    studentEnrollmentYears[name] =
      cohort.label === 'JG-2023' ? 2023 : cohort.label === 'JG-2024' ? 2024 : 2025;
    studentClasses[name] = classForStudent(cohort, i, 4, name);
    studentComments[name] = pick(FUNNY, ci * 20 + i);
    if ((ci * 20 + i) % 17 === 0) studentAssistants[name] = true;
    studentPriorityScores[name] = 3 + ((ci * 20 + i) % 8);
  }
});

if (students.includes(repeatStudent)) {
  studentEnrollmentYears[repeatStudent] = 2024;
  studentMeta[repeatStudent].cohort = COHORTS[1];
}
studentPriorityScores[repeatStudent] = 2;
studentComments[repeatStudent] =
  'Sitzen geblieben: Einschulungsjahr 2024 (wie beim ersten Wahl-Upload) — Klasse hängt in 6b, Jahrgang bleibt.';

const workshopNames = Object.keys(WORKSHOPS);

function assignWorkshop(student, trimesterIndex, bandIndex, skew = false) {
  const hot = ['Film & Medien', 'Robotik Lab', 'Film Grundlagen'];
  const calm = ['Garten & Natur', 'Theater & Bühne', 'Druck & Grafik'];
  if (skew && Math.random() < 0.55) return pick(hot, student.length + bandIndex);
  if (Math.random() < 0.25) return pick(calm, student.charCodeAt(0) + trimesterIndex);
  return pick(workshopNames, student.charCodeAt(1) + trimesterIndex + bandIndex);
}

/** Wahl 1 und 2 über die Kurse verteilen. Nur ein Teil bleibt bei der späteren Zuordnung. */
function demoVotes(name, trimesterIndex, bandIndex, assigned) {
  const pool = workshopNames;
  const seed = voteSeed(name, trimesterIndex, bandIndex);
  const keepAssignment = assigned && assigned !== 'Nicht Zugeordnet' && seed % 5 < 2;
  const wahl1 = keepAssignment ? assigned : pool[seed % pool.length];
  let wahl2 = pool[(seed + 3 + bandIndex) % pool.length];
  if (wahl2 === wahl1) wahl2 = pool[(seed + 1) % pool.length];
  if (wahl2 === wahl1) wahl2 = pool.find(workshop => workshop !== wahl1) || wahl1;
  return [wahl1, wahl2];
}

function buildAssignmentsForTrimester(tIdx, bandCount) {
  const assignments = {};
  BAND_IDS.slice(0, bandCount).forEach(bid => {
    assignments[bid] = {};
  });
  studentsForTrimester(tIdx).forEach(s => {
    for (let b = 0; b < bandCount; b++) {
      const skew = tIdx >= 4;
      let w = assignWorkshop(s, tIdx, b, skew);
      if (s === repeatStudent && tIdx >= 3 && Math.random() < 0.4) {
        w = 'Nicht Zugeordnet';
      }
      if (w === 'Film Vertiefung' && !studentHasCourse(s, tIdx, 'Film Grundlagen')) {
        w = 'Film Grundlagen';
      }
      assignments[BAND_IDS[b]][s] = w;
    }
  });
  // Kapazitäts-Chaos: überfüllen Film in T5
  if (tIdx === 4) {
    studentsForTrimester(tIdx)
      .slice(0, 18)
      .forEach(s => {
        assignments.erstesBand[s] = 'Film & Medien';
      });
  }
  return assignments;
}

function studentHasCourse(student, beforeTrimester, course) {
  // simplified: assume Grundlagen in earlier random trimester for some
  return (student.charCodeAt(0) + course.length) % 3 !== 0 || beforeTrimester > 2;
}

/** Nur diese Kurse pro Band in 2025/26 T3 — Wahl muss aus dem jeweiligen Angebot stammen. */
const UPCOMING_T3_BAND_COURSES = {
  erstesBand: ['Holzwerkstatt', 'Textil & Nähen', 'Garten & Natur'],
  zweitesBand: ['Film Grundlagen', 'Film Vertiefung', 'Robotik Lab', 'Druck & Grafik'],
  drittesBand: ['Küche & Backstube', 'Theater & Bühne', 'Film & Medien'],
};

function configureUpcomingTrimesterCourses(courses, bandIds) {
  workshopNames.forEach(name => {
    courses[name] = { enabled: false, variants: [] };
  });
  bandIds.forEach(bid => {
    (UPCOMING_T3_BAND_COURSES[bid] || []).forEach(name => {
      if (!courses[name]) {
        courses[name] = { enabled: true, variants: [] };
      }
      courses[name].enabled = true;
      const existing = courses[name].variants.find(v => v.bandIds?.length === 1 && v.bandIds[0] === bid);
      if (!existing) {
        courses[name].variants.push({
          id: `v_${name}_${bid}`,
          bandIds: [bid],
          capacity: name === 'Film & Medien' ? 6 : name === 'Robotik Lab' ? 8 : null,
          room: null,
          teacher: null,
          color: null,
        });
      }
    });
  });
}

/** Historie so setzen, dass Regeln greifen, sobald Wahl-Daten manuell hochgeladen werden. */
function seedDemoHistoryForT3Votes(assignmentCaches) {
  const cohort2025 = students.filter(s => studentEnrollmentYears[s] === 2025);
  cohort2025.forEach(s => {
    [3, 4].forEach(idx => {
      const pack = assignmentCaches[idx];
      if (!pack) return;
      BAND_IDS.forEach(bid => {
        if (!pack[bid]) return;
        const w = pack[bid][s];
        if (w === 'Holzwerkstatt' || w === 'Textil & Nähen') {
          pack[bid][s] = bid === 'drittesBand' ? 'Theater & Bühne' : 'Garten & Natur';
        }
      });
    });
  });

  students
    .filter(s => studentEnrollmentYears[s] === 2024)
    .slice(0, 16)
    .forEach(s => {
      if (assignmentCaches[4]?.zweitesBand) {
        assignmentCaches[4].zweitesBand[s] = 'Film Grundlagen';
      }
    });

  if (assignmentCaches[3]?.erstesBand && assignmentCaches[3].erstesBand[repeatStudent] !== undefined) {
    assignmentCaches[3].erstesBand[repeatStudent] = 'Holzwerkstatt';
  }
}

// --- Rules (stable ids for manual checks) ---
const RULES = [
  {
    id: 1001,
    type: 'belegung',
    name: 'Handwerk-Basis (Holz oder Textil)',
    options: ['Holzwerkstatt', 'Textil & Nähen'],
    klassenStufenRange: { from: 5, to: 7 },
    einschulungsjahrFrom: null,
    einschulungsjahrTo: null,
  },
  {
    id: 1002,
    type: 'mindestbelegung',
    name: 'MINT & Medien-Pool (mind. 2)',
    options: ['Film & Medien', 'Robotik Lab', 'Druck & Grafik', 'Film Grundlagen'],
    minCount: 2,
    klassenStufenRange: { from: 8, to: 10 },
    einschulungsjahrFrom: 2018,
    einschulungsjahrTo: 2023,
  },
  {
    id: 1003,
    type: 'folgekurs',
    name: 'Film Grundlagen → Vertiefung',
    fromCourse: 'Film Grundlagen',
    toCourse: 'Film Vertiefung',
    sameBand: true,
    klassenStufenRange: { from: 6, to: 10 },
  },
  {
    id: 1004,
    type: 'folgekurs',
    name: 'Holz → Möbelbau',
    fromCourse: 'Holzwerkstatt',
    toCourse: 'Möbelbau',
    sameBand: false,
    klassenStufenRange: { from: 7, to: 10 },
  },
  {
    id: 1005,
    type: 'freitext',
    name: 'Elterngespräch Dokumentation',
    description: 'Eltern informiert über Werkstattwahl — Haken setzen nach Gespräch.',
    klassenStufenRange: { from: 5, to: 10 },
  },
];

function ruleRow(r) {
  const range = r.klassenStufenRange;
  return [
    r.type,
    r.name,
    (r.options || []).join(', '),
    r.fromCourse || '',
    r.toCourse || '',
    r.sameBand ? 'true' : 'false',
    r.duration != null ? String(r.duration) : '',
    r.minCount != null ? String(r.minCount) : '',
    r.description || '',
    range ? `${range.from}-${range.to}` : '',
    r.einschulungsjahrFrom != null ? String(r.einschulungsjahrFrom) : '',
    r.einschulungsjahrTo != null ? String(r.einschulungsjahrTo) : '',
  ];
}

/** Demo: 2024/25 T1–T2 = 2 Bänder (getrennt Stufe 5/6); ab T3 und ganz 2025/26 = 3 Bänder inkl. gemeinsamem Band. */
function demoBandCountForTrimester(idx) {
  if (idx >= 2) return 3;
  return 2;
}

/** Stufe 5 im ersten Band, ab Stufe 6 im zweiten. Höhere Stufen bleiben angehakt, bis sie abgewählt werden. */
function buildStufenBandAccess(bandIds) {
  const pool = [5, 6, 7, 8, 9, 10];
  const access = {};
  pool.forEach(st => {
    access[st] = [];
  });
  const ids = bandIds.filter(id => BAND_IDS.includes(id));
  const older = ids.length >= 3 ? ['zweitesBand', 'drittesBand'] : ids.length === 2 ? ['zweitesBand'] : [...ids];
  const younger = ids.length >= 3 ? ['erstesBand', 'drittesBand'] : ids.length === 2 ? ['erstesBand'] : [...ids];
  access[5] = younger;
  pool.filter(st => st !== 5).forEach(st => {
    access[st] = [...older];
  });
  return access;
}

function bandSubtitlesFor(bandIds) {
  if (bandIds.length >= 3) {
    return {
      erstesBand: 'Stufe 5',
      zweitesBand: 'Ab Stufe 6',
      drittesBand: 'Gemeinsam',
    };
  }
  return {
    erstesBand: 'Stufe 5',
    zweitesBand: 'Ab Stufe 6',
  };
}

function buildTrimesterPlans() {
  const plans = {};
  TRIMESTERS.forEach((tr, idx) => {
    const key = slotKey(tr);
    const isUpcoming = idx === 5;
    const bandCount = demoBandCountForTrimester(idx);
    const bandIds = BAND_IDS.slice(0, bandCount);
    const stufenBandAccess = buildStufenBandAccess(bandIds);
    const courses = {};
    workshopNames.forEach(w => {
      courses[w] = {
        enabled: true,
        variants: [{ id: `v_${w}`, bandIds: [...bandIds], capacity: null, room: null, teacher: null, color: null }],
      };
    });
    if (isUpcoming) {
      configureUpcomingTrimesterCourses(courses, bandIds);
    }
    let notes = '';
    if (bandCount >= 3) {
      notes =
        'Demo: Stufe 5 im 1. Band, ab Stufe 6 im 2. Band, 3. Band gemeinsam. Ein Jahrgang ohne Band setzt nur dieses Trimester aus.';
    } else {
      notes = 'Demo: Stufe 5 im 1. Band, ab Stufe 6 im 2. Band.';
    }
    if (isUpcoming) {
      notes +=
        ' Strikt: je Band nur festes Kursangebot (siehe Kurse). Wahl-CSVs folgen Regeln (Handwerk-Basis, Film-Folgekurs). Zuordnung offen.';
    }
    plans[key] = {
      key,
      schoolYearStart: tr.syStart,
      schoolYearEnd: tr.syEnd,
      trimester: tr.t,
      bandCount,
      wahlCount: isUpcoming ? 3 : 2,
      bandSubtitles: bandSubtitlesFor(bandIds),
      stufenBandAccess,
      courses,
      notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
  return plans;
}

async function main() {
  const zip = new JSZip();
  const ts = new Date().toISOString();

  zip.file(
    'students.csv',
    toCsv([['Name'], ...students.map(s => [s])])
  );

  zip.file(
    'workshops.csv',
    toCsv([
      ['WorkshopName', 'Capacity', 'AvailableBands'],
      ...workshopNames.map(n => [n, WORKSHOPS[n].capacity, WORKSHOPS[n].bands.join(', ')]),
    ])
  );

  zip.file(
    'workshop-colors.csv',
    toCsv([['Workshop', 'Color'], ...Object.entries(WORKSHOP_COLORS).map(([w, c]) => [w, c])])
  );
  zip.file(
    'workshop-teachers.csv',
    toCsv([['Workshop', 'Teacher'], ...Object.entries(TEACHERS).map(([w, t]) => [w, t])])
  );
  zip.file(
    'workshop-rooms.csv',
    toCsv([['Workshop', 'Room'], ...Object.entries(ROOMS).map(([w, r]) => [w, r])])
  );
  zip.file(
    'prerequisites.csv',
    toCsv([
      ['Workshop', 'RequiredCourses'],
      ...Object.entries(PREREQS).map(([w, list]) => [w, list.join(', ')]),
    ])
  );
  zip.file(
    'cannot-be-parallel.csv',
    toCsv([
      ['Workshop', 'CannotBeParallelWith'],
      ...Object.entries(NO_PARALLEL).map(([w, list]) => [w, list.join(', ')]),
    ])
  );

  zip.file(
    'rules.csv',
    toCsv([['RuleType', 'RuleName', 'Options', 'FromCourse', 'ToCourse', 'SameBand', 'Duration', 'MinCount', 'Description', 'KlassenStufen', 'EinschulungVon', 'EinschulungBis'], ...RULES.map(ruleRow)])
  );

  zip.file(
    'student-enrollment-years.csv',
    toCsv([['Student', 'EnrollmentYear'], ...students.map(s => [s, String(studentEnrollmentYears[s])])])
  );
  zip.file(
    'student-classes.csv',
    toCsv([['Student', 'Class'], ...students.map(s => [s, studentClasses[s]])])
  );
  zip.file(
    'student-comments.csv',
    toCsv([['Student', 'Comment'], ...students.map(s => [s, studentComments[s]])])
  );
  zip.file(
    'student-assistants.csv',
    toCsv([
      ['Student', 'NeedsAssistance'],
      ...students.filter(s => studentAssistants[s]).map(s => [s, 'Ja']),
    ])
  );
  zip.file(
    'priority-scores.csv',
    toCsv([['Student', 'PriorityScore'], ...students.map(s => [s, String(studentPriorityScores[s])])])
  );

  zip.file('class-registry.json', JSON.stringify(['5a', '5b', '6a', '6b', '7a', '7b', '8a', '8b'], null, 2));
  zip.file('klassenstufen-pool.json', JSON.stringify([5, 6, 7, 8, 9, 10], null, 2));
  zip.file('trimester-plans.json', JSON.stringify(buildTrimesterPlans(), null, 2));

  zip.file(
    'README-demo.txt',
    `Werkstatt-Verwaltung Demo-Daten
================================
Import via App: Daten → ZIP importieren

Inhalt:
- 60 Schüler (3 Jahrgänge × 20), Einschulungsjahre 2023 / 2024 / 2025
  · Teilnahme hängt nur an den angehakten Bändern der Klassenstufe, nicht daran, ob der Jahrgang „die Schule verlassen“ hätte
  · 2025: in den Demo-Dateien erst ab 2025/26, weil die Stufe davor in keinem Band hängt. Haken setzen, dann ist er dabei
- 6 Trimester (2024/25 T1–T3, 2025/26 T1–T3)
- Trimester-Organisation (stufenBandAccess):
  · 2024/25 T1–T2: 2 Bänder — Band 1 nur Stufe 5, Band 2 nur Stufe 6
  · 2024/25 T3 und 2025/26 T1–T3: 3 Bänder — + Band 3 für Stufe 5 & 6 gemeinsam
- Trimester 1–5: Zuordnungen (2 oder 3 Bänder je nach Plan)
- trimester-plans.json: alle Trimester-Konfigurationen (Bänder, Wahlen, Kurse, Stufen-Zugriff)
- 2025/26 T3: nur Trimester-Plan (Kursangebot pro Band), keine Zuordnung, keine Wahl-Dateien
- Wahl-CSV je Band für die Trimester mit Zuordnung: Student, Klasse, Wahl 1, Wahl 2
- Wahl 1 und Wahl 2 sind über die Kurse verteilt; nur ein Teil der ersten Wahlen entspricht der späteren Zuordnung
- Die Klasse im Wahl-Upload ist die Klasse in diesem Trimester (nicht die spätere Schülerakte)

Einschulungsjahr-Logik (wie App):
- Stufe 5 in SJ 2024/25 → 2024; Stufe 6 → 2023; JG 2025 nur ab 2025/26 T1
- ${repeatStudent}: bleibt in 6b, Einschulungsjahr 2024 unverändert (Sitzenbleiben)

Demo-Kanten:
- Film & Medien in T5 überbucht
- Möbelbau ohne überall erfüllte Holz-Voraussetzung
- Lustige Kommentare & uneinheitliche Priority-Scores
`
  );

  const assignmentCaches = {};
  for (let idx = 0; idx < 5; idx += 1) {
    assignmentCaches[idx] = buildAssignmentsForTrimester(idx, demoBandCountForTrimester(idx));
  }
  seedDemoHistoryForT3Votes(assignmentCaches);

  TRIMESTERS.forEach((tr, idx) => {
    const key = slotKey(tr);
    const bandCount = demoBandCountForTrimester(idx);
    if (idx < 5) {
      const assignments = assignmentCaches[idx];
      const headers = ['Student', ...BAND_HEADERS.slice(0, bandCount), 'Timestamp'];
      const rows = [headers];
      studentsForTrimester(idx).forEach(s => {
        const row = [s];
        for (let b = 0; b < bandCount; b++) {
          row.push(assignments[BAND_IDS[b]][s] || 'Nicht Zugeordnet');
        }
        row.push(ts);
        rows.push(row);
      });
      zip.file(`assignments/${key}.csv`, toCsv(rows));

      const access = buildStufenBandAccess(BAND_IDS.slice(0, bandCount));
      BAND_IDS.slice(0, bandCount).forEach(bandId => {
        const choiceRows = [['Student', 'Klasse', 'Wahl 1', 'Wahl 2']];
        studentsForTrimester(idx).forEach(name => {
          const stufe = stufeForStudentAtTrimester(name, idx);
          if (!(access[stufe] || []).includes(bandId)) return;
          const meta = studentMeta[name];
          const klasse = classForStudent(meta.cohort, meta.studentIndex, idx, name);
          const assigned = assignments[bandId]?.[name];
          const [wahl1, wahl2] = demoVotes(name, idx, BAND_IDS.indexOf(bandId), assigned);
          choiceRows.push([name, klasse, wahl1, wahl2]);
        });
        if (choiceRows.length > 1) {
          zip.file(`choices/${key}_${bandId}.csv`, toCsv(choiceRows));
        }
      });
    }
  });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const outPath = path.join(OUT_DIR, 'werkstatt-demo.zip');
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outPath, buffer);

  console.log(`✅ Demo-ZIP erstellt: ${outPath}`);
  console.log(`   ${students.length} Schüler, ${TRIMESTERS.length} Trimester, ${workshopNames.length} Werkstätten`);
  console.log('   Import in der App unter „Daten“ → ZIP-Import (Zuordnungen, Wahl-CSVs mit Klasse, Pläne).');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
