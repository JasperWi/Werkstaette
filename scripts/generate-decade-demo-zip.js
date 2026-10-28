/**
 * Second demo: ten school years, cohorts from Stufe 5 through graduation at Stufe 10,
 * courses that start, change, and get archived.
 * The newest trimester is planned only — no assignment file and no Wahl upload.
 *
 * Usage: node scripts/generate-decade-demo-zip.js
 * Output: scripts/output/werkstatt-demo-10-jahre.zip
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const SEP = ';';
const OUT_DIR = path.join(__dirname, 'output');
const FIRST_YEAR = 2017;
const LAST_YEAR = 2026;
const FIRST_COHORT = 2016;
const STUDENTS_PER_COHORT = 16;
const ENTRY_STUFE = 5;
const GRAD_STUFE = 10;

const BAND_IDS = ['erstesBand', 'zweitesBand', 'drittesBand', 'viertesBand', 'fuenftesBand', 'sechstesBand'];
const BAND_HEADERS = ['ErstesBand', 'ZweitesBand', 'DrittesBand', 'ViertesBand', 'FuenftesBand', 'SechstesBand'];

const FIRST = [
  'Lina', 'Finn', 'Maja', 'Ben', 'Nora', 'Elias', 'Zoe', 'Paul', 'Mila', 'Noah',
  'Hannah', 'Leo', 'Emma', 'Luis', 'Clara', 'Jonas', 'Sophie', 'Max', 'Amelie', 'Tim',
  'Ida', 'Theo', 'Greta', 'Anton', 'Frieda', 'Oskar', 'Mara', 'Jannis', 'Nele', 'Mats',
  'Pia', 'Henri', 'Lotta', 'Karl', 'Elisa', 'Jona', 'Merle', 'Lennart', 'Tilda', 'Ruben',
];
const LAST = [
  'Müller', 'Schmidt', 'Weber', 'Fischer', 'Becker', 'Wagner', 'Hoffmann', 'Koch', 'Richter', 'Klein',
  'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Krüger', 'Lange', 'Schmitt', 'Meier', 'Lehmann',
  'Köhler', 'Bauer', 'König', 'Schulz', 'Vogel', 'Hartmann', 'Frank', 'Berg', 'Ott', 'Kruse',
  'Peters', 'Sommer', 'Brandt', 'Lorenz', 'Keller', 'Busch', 'Graf', 'Albrecht', 'Seidel', 'Voigt',
];

function csvEscape(cell) {
  const cellStr = String(cell ?? '');
  if (cellStr.includes(SEP) || cellStr.includes('"') || cellStr.includes('\n')) {
    return `"${cellStr.replace(/"/g, '""')}"`;
  }
  return cellStr;
}

function toCsv(rows) {
  const body = rows.map(row => row.map(csvEscape).join(SEP)).join('\r\n');
  return `\uFEFF${body}`;
}

function slotKey(year, trimester) {
  return `${year}-${year + 1} T${trimester}`;
}

function hashSeed(text, a, b) {
  let hash = (a * 17 + b * 5 + 11) >>> 0;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function valueAt(steps, year) {
  let value = steps[0].value;
  steps.forEach(step => {
    if (year >= step.from) value = step.value;
  });
  return value;
}

/** from/to are school-year starts. to = null means the course is still running in LAST_YEAR. */
const COURSES = [
  {
    name: 'Holzwerkstatt', from: 2017, to: null, color: '#8B4513',
    capacity: [{ from: 2017, value: 8 }, { from: 2022, value: 12 }],
    teacher: [{ from: 2017, value: 'Meister Hansen' }, { from: 2023, value: 'Meisterin Vogt' }],
    room: [{ from: 2017, value: 'Werk-H1' }],
    bands: [{ from: 2017, value: [0, 1] }, { from: 2022, value: [0, 1, 2] }],
  },
  {
    name: 'Textil & Nähen', from: 2017, to: null, color: '#E91E63',
    capacity: [{ from: 2017, value: 10 }, { from: 2021, value: 14 }],
    teacher: [{ from: 2017, value: 'Fr. Schneider' }],
    room: [{ from: 2017, value: 'Näh-2' }],
    bands: [{ from: 2017, value: [0] }, { from: 2020, value: [0, 1] }],
  },
  {
    name: 'Küche & Backstube', from: 2017, to: null, color: '#FF9800',
    capacity: [{ from: 2017, value: 10 }],
    teacher: [{ from: 2017, value: 'Herr Krümel' }, { from: 2024, value: 'Fr. Teig' }],
    room: [{ from: 2017, value: 'Küche A' }],
    bands: [{ from: 2017, value: [0, 1] }],
  },
  {
    name: 'Theater & Bühne', from: 2017, to: null, color: '#F44336', allowSelf: true,
    capacity: [{ from: 2017, value: 14 }, { from: 2024, value: 16 }],
    teacher: [{ from: 2017, value: 'Herr Dramaturg' }],
    room: [{ from: 2017, value: 'Aula' }],
    bands: [{ from: 2017, value: [1] }, { from: 2024, value: [1, 3] }],
  },
  {
    name: 'Garten & Natur', from: 2019, to: null, color: '#4CAF50', allowSelf: true,
    capacity: [{ from: 2019, value: 12 }, { from: 2025, value: 16 }],
    teacher: [{ from: 2019, value: 'Fr. Gießkanne' }],
    room: [{ from: 2019, value: 'Schulgarten' }],
    bands: [{ from: 2019, value: [0] }, { from: 2023, value: [0, 2] }],
  },
  {
    name: 'Druck & Grafik', from: 2018, to: null, color: '#795548',
    capacity: [{ from: 2018, value: 8 }],
    teacher: [{ from: 2018, value: 'Herr Raster' }],
    room: [{ from: 2018, value: 'Druck-1' }],
    bands: [{ from: 2018, value: [1] }, { from: 2021, value: [1, 2] }],
  },
  {
    name: 'Film Grundlagen', from: 2019, to: null, color: '#9C27B0',
    capacity: [{ from: 2019, value: 10 }],
    teacher: [{ from: 2019, value: 'Fr. Kamera' }],
    room: [{ from: 2019, value: 'Studio 7' }],
    bands: [{ from: 2019, value: [1] }, { from: 2024, value: [1, 2] }],
  },
  {
    name: 'Film Vertiefung', from: 2020, to: null, color: '#3F51B5',
    capacity: [{ from: 2020, value: 8 }],
    teacher: [{ from: 2020, value: 'Herr Schnitt' }],
    room: [{ from: 2020, value: 'Studio 9' }],
    bands: [{ from: 2020, value: [1, 2] }],
  },
  {
    name: 'Film & Medien', from: 2020, to: null, color: '#673AB7',
    capacity: [{ from: 2020, value: 6 }, { from: 2025, value: 8 }],
    teacher: [{ from: 2020, value: 'Fr. Kamera' }],
    room: [{ from: 2020, value: 'Studio 9' }],
    bands: [{ from: 2020, value: [2] }, { from: 2024, value: [2, 3] }],
  },
  {
    name: 'Robotik Lab', from: 2021, to: null, color: '#2196F3',
    capacity: [{ from: 2021, value: 6 }, { from: 2024, value: 10 }],
    teacher: [{ from: 2021, value: 'Dr. Servo' }],
    room: [{ from: 2021, value: 'MINT-404' }],
    bands: [{ from: 2021, value: [1, 2] }, { from: 2024, value: [1, 2, 3] }],
  },
  {
    name: 'Möbelbau', from: 2020, to: null, color: '#607D8B',
    capacity: [{ from: 2020, value: 6 }],
    teacher: [{ from: 2020, value: 'Meister Hansen' }, { from: 2023, value: 'Meisterin Vogt' }],
    room: [{ from: 2020, value: 'Werk-H2' }],
    bands: [{ from: 2020, value: [2] }, { from: 2024, value: [2, 3] }],
  },
  {
    name: 'Keramik', from: 2022, to: null, color: '#C2185B',
    capacity: [{ from: 2022, value: 10 }],
    teacher: [{ from: 2022, value: 'Fr. Ton' }],
    room: [{ from: 2022, value: 'Brennraum' }],
    bands: [{ from: 2022, value: [0, 1] }],
  },
  {
    name: 'Musikwerkstatt', from: 2023, to: null, color: '#009688',
    capacity: [{ from: 2023, value: 12 }],
    teacher: [{ from: 2023, value: 'Herr Takt' }],
    room: [{ from: 2023, value: 'Musik-1' }],
    bands: [{ from: 2023, value: [0, 3] }],
  },
  {
    name: 'Coding & Apps', from: 2024, to: null, color: '#1565C0',
    capacity: [{ from: 2024, value: 10 }],
    teacher: [{ from: 2024, value: 'Fr. Byte' }],
    room: [{ from: 2024, value: 'MINT-210' }],
    bands: [{ from: 2024, value: [2, 3] }],
  },
  {
    name: 'Upcycling', from: 2025, to: null, color: '#7CB342',
    capacity: [{ from: 2025, value: 12 }],
    teacher: [{ from: 2025, value: 'Herr Fund' }],
    room: [{ from: 2025, value: 'Werk-H3' }],
    bands: [{ from: 2025, value: [3] }, { from: 2026, value: [0, 3] }],
  },
  {
    name: 'Fotolabor', from: 2017, to: 2019, color: '#6A1B9A',
    capacity: [{ from: 2017, value: 8 }],
    teacher: [{ from: 2017, value: 'Fr. Dunkelkammer' }],
    room: [{ from: 2017, value: 'Studio 9' }],
    bands: [{ from: 2017, value: [1] }],
  },
  {
    name: 'Computer-AG', from: 2017, to: 2020, color: '#0277BD',
    capacity: [{ from: 2017, value: 8 }, { from: 2019, value: 12 }],
    teacher: [{ from: 2017, value: 'Herr Platine' }],
    room: [{ from: 2017, value: 'PC-Raum' }],
    bands: [{ from: 2017, value: [1] }],
  },
  {
    name: 'Schulgarten', from: 2017, to: 2018, color: '#558B2F',
    capacity: [{ from: 2017, value: 10 }],
    teacher: [{ from: 2017, value: 'Fr. Beet' }],
    room: [{ from: 2017, value: 'Hinterhof' }],
    bands: [{ from: 2017, value: [0] }],
  },
  {
    name: 'Töpfern', from: 2017, to: 2021, color: '#AD1457',
    capacity: [{ from: 2017, value: 8 }, { from: 2020, value: 12 }],
    teacher: [{ from: 2017, value: 'Fr. Ton' }],
    room: [{ from: 2017, value: 'Brennraum' }],
    bands: [{ from: 2017, value: [0] }],
  },
  {
    name: 'Siebdruck', from: 2018, to: 2022, color: '#6D4C41',
    capacity: [{ from: 2018, value: 8 }],
    teacher: [{ from: 2018, value: 'Herr Raster' }, { from: 2021, value: 'Fr. Sieb' }],
    room: [{ from: 2018, value: 'Druck-2' }],
    bands: [{ from: 2018, value: [1] }],
  },
  {
    name: 'Holz Grundlagen', from: 2017, to: 2019, color: '#A1887F',
    capacity: [{ from: 2017, value: 10 }],
    teacher: [{ from: 2017, value: 'Meister Hansen' }],
    room: [{ from: 2017, value: 'Werk-H2' }],
    bands: [{ from: 2017, value: [0] }],
  },
  {
    name: 'Nähen Einsteiger', from: 2017, to: 2018, color: '#F06292',
    capacity: [{ from: 2017, value: 10 }],
    teacher: [{ from: 2017, value: 'Fr. Schneider' }],
    room: [{ from: 2017, value: 'Näh-1' }],
    bands: [{ from: 2017, value: [0] }],
  },
  {
    name: 'Schülerzeitung', from: 2019, to: 2023, color: '#455A64',
    capacity: [{ from: 2019, value: 8 }],
    teacher: [{ from: 2019, value: 'Fr. Satz' }],
    room: [{ from: 2019, value: 'Redaktion' }],
    bands: [{ from: 2019, value: [1, 2] }],
  },
  {
    name: 'Schach & Strategie', from: 2020, to: 2024, color: '#37474F',
    capacity: [{ from: 2020, value: 12 }],
    teacher: [{ from: 2020, value: 'Herr Zug' }],
    room: [{ from: 2020, value: 'Bibliothek' }],
    bands: [{ from: 2020, value: [2, 3] }],
  },
];

function isActive(course) {
  return course.to == null || course.to >= LAST_YEAR;
}

function offeredInYear(course, year) {
  return year >= course.from && (course.to == null || year <= course.to);
}

function programMaxStufe(year) {
  if (year <= 2017) return 6;
  if (year === 2018) return 7;
  if (year === 2019) return 8;
  if (year === 2020) return 9;
  return 10;
}

function yearStufen(year) {
  const stufen = [];
  for (let stufe = ENTRY_STUFE; stufe <= programMaxStufe(year); stufe += 1) stufen.push(stufe);
  return stufen;
}

function skippedStufen(year, trimester) {
  if (year === 2017 && trimester === 2) return [6];
  if (year === 2021 && trimester === 2) return [8];
  if (year === 2024 && trimester === 1) return [9];
  return [];
}

/** Who is planned on each band, including a grade that sits this trimester out. */
function plannedBands(year, trimester) {
  const max = programMaxStufe(year);
  const keep = stufen => stufen.filter(stufe => stufe >= ENTRY_STUFE && stufe <= max);
  let bands;
  if (year === 2017) {
    bands = trimester === 3 ? [[5, 6], [5, 6]] : [[5, 6], [6]];
  } else if (year === 2018) {
    bands = trimester === 2 ? [[5, 6, 7], [7]] : [[5, 6], [6, 7]];
  } else if (year === 2019) {
    bands = trimester === 2 ? [[5, 6], [6, 7, 8], [8]] : [[5, 6], [6, 7], [7, 8]];
  } else if (year === 2020) {
    bands = trimester === 3 ? [[5, 6], [7, 8, 9], [9]] : [[5, 6], [7, 8], [8, 9]];
  } else if (year === 2021) {
    if (trimester === 3) bands = [[5, 6], [6, 7], [7, 8, 9], [9, 10]];
    else bands = [[5, 6], [6, 7], [8, 9], [9, 10]];
  } else if (year === 2022) {
    bands = trimester === 2
      ? [[5, 6], [6, 7], [8, 9], [9, 10]]
      : [[5, 6], [7, 8], [8, 9], [9, 10]];
  } else if (year === 2023) {
    bands = trimester === 1
      ? [[5, 6, 7], [7, 8], [8, 9], [10]]
      : [[5, 6], [7, 8], [8, 9], [9, 10]];
  } else if (year === 2024) {
    bands = trimester === 1
      ? [[5, 6], [6, 7], [7, 8], [8, 10]]
      : [[5, 6], [6, 7], [8, 9], [9, 10]];
  } else if (year === 2025 && trimester === 2) {
    bands = [[5, 6, 7], [8, 9], [9, 10]];
  } else {
    bands = [[5, 6], [6, 7], [8, 9], [9, 10]];
  }
  return bands.map(keep);
}

function bandCount(year, trimester) {
  return plannedBands(year, trimester).length;
}

function formatStufen(stufen) {
  if (stufen.length === 1) return `Stufe ${stufen[0]}`;
  const consecutive = stufen.every((stufe, index) => index === 0 || stufe === stufen[index - 1] + 1);
  if (consecutive && stufen.length === 2) return `Stufe ${stufen[0]}–${stufen[1]}`;
  if (stufen.length === 2) return `Stufe ${stufen[0]} und ${stufen[1]}`;
  return `Stufe ${stufen.slice(0, -1).join(', ')} und ${stufen[stufen.length - 1]}`;
}

const BAND_GROUPS = {
  5: [
    ['Holz Grundlagen', 'Holzwerkstatt'],
    ['Nähen Einsteiger', 'Textil & Nähen'],
    ['Küche & Backstube'],
    ['Schulgarten', 'Garten & Natur', 'Töpfern', 'Keramik'],
  ],
  6: [
    ['Textil & Nähen', 'Nähen Einsteiger'],
    ['Theater & Bühne'],
    ['Fotolabor', 'Film Grundlagen', 'Film & Medien'],
    ['Computer-AG', 'Töpfern', 'Keramik', 'Musikwerkstatt'],
  ],
  7: [
    ['Theater & Bühne'],
    ['Druck & Grafik', 'Siebdruck'],
    ['Film Grundlagen', 'Schülerzeitung'],
    ['Computer-AG', 'Robotik Lab', 'Coding & Apps'],
  ],
  8: [
    ['Computer-AG', 'Robotik Lab', 'Coding & Apps'],
    ['Film Grundlagen'],
    ['Film Vertiefung', 'Film & Medien'],
    ['Druck & Grafik', 'Schach & Strategie', 'Siebdruck'],
  ],
  9: [
    ['Film & Medien', 'Film Vertiefung'],
    ['Möbelbau'],
    ['Siebdruck', 'Druck & Grafik', 'Schach & Strategie'],
    ['Upcycling', 'Coding & Apps', 'Robotik Lab'],
  ],
  10: [
    ['Möbelbau'],
    ['Robotik Lab', 'Coding & Apps'],
    ['Upcycling', 'Schach & Strategie'],
    ['Film Vertiefung', 'Film & Medien'],
  ],
};

function coursePaused(name, year, trimester) {
  return name === 'Schulgarten' && year === 2018 && trimester === 2;
}

function coursesOnBand(year, bandIndex, trimester = 1) {
  const stufen = plannedBands(year, trimester)[bandIndex] || [];
  if (!stufen.length) return [];
  const alive = name => {
    const course = COURSES.find(item => item.name === name);
    if (!course || !offeredInYear(course, year) || coursePaused(name, year, trimester)) return null;
    return course;
  };
  const lists = stufen.map(stufe => (BAND_GROUPS[stufe] || [])
    .map(names => names.map(alive).find(Boolean))
    .filter(Boolean));
  const picked = [];
  let guard = 0;
  while (picked.length < 4 && lists.some(list => list.length) && guard < 24) {
    const list = lists[guard % lists.length];
    guard += 1;
    if (!list.length) continue;
    const course = list.shift();
    if (!picked.includes(course)) picked.push(course);
  }
  return picked;
}

function bandsOffered(course, year, trimester = 1) {
  const indexes = [];
  plannedBands(year, trimester).forEach((_, index) => {
    if (coursesOnBand(year, index, trimester).some(item => item.name === course.name)) indexes.push(index);
  });
  return indexes;
}

function bandAccess(year, trimester) {
  const access = {};
  for (let stufe = -8; stufe <= 40; stufe += 1) access[stufe] = [];
  const skip = new Set(skippedStufen(year, trimester));
  plannedBands(year, trimester).forEach((stufen, index) => {
    stufen.forEach(stufe => {
      if (skip.has(stufe)) return;
      access[stufe].push(BAND_IDS[index]);
    });
  });
  return access;
}

function subtitles(year, trimester) {
  const map = {};
  plannedBands(year, trimester).forEach((stufen, index) => {
    map[BAND_IDS[index]] = formatStufen(stufen);
  });
  return map;
}

const TRIMESTERS = [];
for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
  for (let trimester = 1; trimester <= 3; trimester += 1) {
    TRIMESTERS.push({ year, trimester, open: year === LAST_YEAR && trimester === 3 });
  }
}

const students = [];
const usedNames = new Set();
for (let enrollment = FIRST_COHORT; enrollment <= LAST_YEAR; enrollment += 1) {
  for (let index = 0; index < STUDENTS_PER_COHORT; index += 1) {
    let name = `${FIRST[(enrollment + index * 3) % FIRST.length]} ${LAST[(enrollment * 2 + index) % LAST.length]}`;
    if (usedNames.has(name)) name = `${name} ${enrollment}`;
    usedNames.add(name);
    const repeatFrom = [2018, 2021, 2024].includes(enrollment) && index === 3 ? enrollment + 2 : null;
    students.push({
      name,
      enrollment,
      index,
      letter: index < STUDENTS_PER_COHORT / 2 ? 'a' : 'b',
      repeatFrom,
      assistant: (enrollment + index) % 18 === 0,
      priority: 3 + ((enrollment + index * 5) % 7),
    });
  }
}

function formulaStufe(student, year) {
  return year - student.enrollment + ENTRY_STUFE;
}

function displayStufe(student, year) {
  let stufe = formulaStufe(student, year);
  if (student.repeatFrom && year >= student.repeatFrom) stufe -= 1;
  return stufe;
}

function votesInYear(student, year, trimester) {
  const stufe = formulaStufe(student, year);
  if (!yearStufen(year).includes(stufe)) return false;
  return !skippedStufen(year, trimester).includes(stufe);
}

function classNameAt(student, year) {
  const voting = formulaStufe(student, year);
  if (voting > GRAD_STUFE) return `10${student.letter}`;
  let stufe = displayStufe(student, year);
  if (stufe > GRAD_STUFE) stufe = GRAD_STUFE;
  if (stufe < ENTRY_STUFE) stufe = ENTRY_STUFE;
  return `${stufe}${student.letter}`;
}

function currentClass(student) {
  return classNameAt(student, LAST_YEAR);
}

function commentFor(student) {
  const graduated = formulaStufe(student, LAST_YEAR) > GRAD_STUFE;
  const gradYear = student.enrollment + (GRAD_STUFE - ENTRY_STUFE);
  if (graduated) {
    return `Abschluss nach Stufe 10 im Schuljahr ${gradYear}/${gradYear + 1}.`;
  }
  if (student.repeatFrom) {
    return `Klassenwiederholung ab ${student.repeatFrom}/${student.repeatFrom + 1}. Einschulungsjahr bleibt ${student.enrollment}.`;
  }
  const notes = [
    'Will nach der Holzwerkstatt in den Möbelbau.',
    'Hat den Wechsel von der Computer-AG ins Robotik Lab mitgemacht.',
    'Fragt jedes Jahr, ob das Fotolabor wieder aufmacht.',
    'Bringt Snacks in die Küche mit und nennt das „Materialkunde“.',
    'Theater und Film gleichzeitig ist untersagt. Steht schon in der Akte.',
    'War beim Töpfern dabei, bevor daraus Keramik wurde.',
  ];
  return notes[(student.enrollment + student.index) % notes.length];
}

function timestampFor(year, trimester) {
  const month = trimester === 1 ? 11 : trimester === 2 ? 2 : 5;
  const stampYear = trimester === 1 ? year : year + 1;
  return new Date(Date.UTC(stampYear, month - 1, 18, 15, 0, 0)).toISOString();
}

const assignments = TRIMESTERS.map(tr => {
  if (tr.open) return null;
  const byStudent = {};
  students.forEach(student => {
    if (!votesInYear(student, tr.year, tr.trimester)) return;
    const access = bandAccess(tr.year, tr.trimester);
    const stufe = formulaStufe(student, tr.year);
    const bandIndexes = (access[stufe] || []).map(id => BAND_IDS.indexOf(id));
    const taken = new Set();
    const row = {};
    bandIndexes.forEach(bandIndex => {
      const offered = coursesOnBand(tr.year, bandIndex, tr.trimester);
      if (!offered.length) return;
      const seed = hashSeed(student.name, tr.year * 3 + tr.trimester, bandIndex);
      if (seed % 23 === 0) {
        row[bandIndex] = 'Nicht Zugeordnet';
        return;
      }
      const choices = offered.filter(course => course.allowSelf || !taken.has(course.name));
      const pool = choices.length ? choices : offered;
      const pick = pool[seed % pool.length];
      row[bandIndex] = pick.name;
      taken.add(pick.name);
    });
    byStudent[student.name] = row;
  });
  return byStudent;
});

TRIMESTERS.forEach((tr, index) => {
  if (tr.open || index === 0) return;
  students.forEach(student => {
    const previous = index - 1;
    if (previous < 0 || !assignments[previous]?.[student.name] || !assignments[index]?.[student.name]) return;
    const prevRow = assignments[previous][student.name];
    const nextRow = assignments[index][student.name];
    Object.keys(prevRow).forEach(bandKey => {
      if (prevRow[bandKey] !== 'Film Grundlagen') return;
      const bandIndex = Number(bandKey);
      if (!coursesOnBand(tr.year, bandIndex, tr.trimester).some(course => course.name === 'Film Vertiefung')) return;
      if (nextRow[bandIndex] != null) nextRow[bandIndex] = 'Film Vertiefung';
    });
  });
});

students.forEach(student => {
  const handwerkSlots = [];
  TRIMESTERS.forEach((tr, index) => {
    if (tr.open || !assignments[index]?.[student.name]) return;
    const stufe = formulaStufe(student, tr.year);
    if (stufe < 5 || stufe > 7) return;
    Object.keys(assignments[index][student.name]).forEach(bandKey => {
      handwerkSlots.push({ index, bandIndex: Number(bandKey), year: tr.year });
    });
  });
  const taken = new Set();
  handwerkSlots.forEach(slot => {
    const name = assignments[slot.index][student.name][slot.bandIndex];
    if (name === 'Holzwerkstatt' || name === 'Textil & Nähen') taken.add(name);
  });
  if (taken.size > 0 || !handwerkSlots.length) return;
  const slot = [...handwerkSlots].reverse().find(item => {
    const offered = coursesOnBand(item.year, item.bandIndex, TRIMESTERS[item.index].trimester).map(course => course.name);
    return offered.includes('Holzwerkstatt') || offered.includes('Textil & Nähen');
  });
  if (!slot) return;
  const offered = coursesOnBand(slot.year, slot.bandIndex, TRIMESTERS[slot.index].trimester).map(course => course.name);
  assignments[slot.index][student.name][slot.bandIndex] = offered.includes('Holzwerkstatt') ? 'Holzwerkstatt' : 'Textil & Nähen';
});

const OVERFILL_YEAR = 2022;
const overfill = TRIMESTERS.findIndex(tr => tr.year === OVERFILL_YEAR && tr.trimester === 2);
if (overfill >= 0) {
  students
    .filter(student => formulaStufe(student, OVERFILL_YEAR) <= 6 && assignments[overfill]?.[student.name]?.[0] != null)
    .slice(0, 16)
    .forEach(student => {
      assignments[overfill][student.name][0] = 'Küche & Backstube';
    });
}

function planNotes(tr) {
  if (tr.open) {
    return 'Plan für 2026/27 T3: vier Bänder, die Jahrgänge teilen sich die Slots (5 mit 6, 6 mit 7, 8 mit 9, 9 mit 10). Die Wahl ist noch nicht hochgeladen, eine Zuordnung gibt es noch nicht.';
  }
  const stories = {
    '2017-1': 'Start. Zwei Bänder, aber das 1. Band gehört Stufe 5 und 6 zusammen: Holz Grundlagen, Nähen, Küche, Schulgarten. Stufe 6 hat zusätzlich das 2. Band mit Textil, Theater, Fotolabor und Computer-AG.',
    '2017-2': 'Stufe 6 ist auf Klassenfahrt. Das 2. Band bleibt stehen, es wählt niemand. Im 1. Band bleibt nur Stufe 5.',
    '2017-3': 'Stufe 6 ist zurück, und diesmal teilen sich beide Jahrgänge beide Bänder. Fotolabor und Computer-AG laufen wieder.',
    '2018-1': 'Stufe 7 ist da, ohne neues Band. 1. Band: Stufe 5 und 6. 2. Band: Stufe 6 und 7. Druck & Grafik und Siebdruck starten bei den Älteren. Nähen Einsteiger läuft das letzte Jahr.',
    '2018-2': 'Wasserrohrbruch, Schulgarten fällt aus und Druck-2 ist nass. Stufe 7 wählt dieses Trimester mit 5 und 6 im 1. Band. Im 2. Band bleibt nur Stufe 7.',
    '2018-3': 'Zurück zur Teilung: 5 mit 6, 6 mit 7. Schulgarten und Nähen Einsteiger das letzte Mal.',
    '2019-1': 'Stufe 8 kommt dazu, drittes Band. 5 mit 6, 6 mit 7, 7 mit 8. Garten & Natur öffnet. Film Grundlagen startet. Textil hat zwei Räume: Näh-2 für die Jüngeren, Näh-1 für Stufe 6.',
    '2019-2': 'Filmprojekt: Stufe 8 setzt sich für ein Trimester mit 6 und 7 ins 2. Band. Computer-AG hat 12 Plätze. Fotolabor noch bis T3.',
    '2019-3': 'Wieder drei geteilte Bänder. Letztes Fotolabor, Fr. Dunkelkammer geht. Holz Grundlagen endet.',
    '2020-1': 'Stufe 9 kommt dazu, immer noch drei Bänder: 5–6, 7–8, 8–9. Film & Medien, Film Vertiefung und Möbelbau starten. Computer-AG läuft das letzte Jahr.',
    '2020-2': 'Gleiche Teilung. Töpfern hat 12 Plätze. Film Vertiefung liegt im Band der Älteren, die Grundlagen bei 7 und 8.',
    '2020-3': 'Abschied der Computer-AG. Stufe 7, 8 und 9 sitzen dafür zusammen im 2. Band. Herr Platine geht, der PC-Raum bleibt für Robotik.',
    '2021-1': 'Stufe 10 ist da. Vier Bänder, fast überall zwei Jahrgänge: 5–6, 6–7, 8–9, 9–10. Robotik ersetzt die Computer-AG, Textil steigt auf 14.',
    '2021-2': 'Stufe 8 im Praktikum. Das 3. Band hat nur noch Stufe 9. Die anderen Bänder bleiben geteilt.',
    '2021-3': 'Stufe 8 ist zurück und setzt sich für ein Trimester mit 7 und 9 ins 3. Band. Letztes Töpfern, im Sommer wird Keramik daraus.',
    '2022-1': 'Keramik startet, Töpfern ist archiviert. Holzwerkstatt von 8 auf 12 Plätze. Teilung: 5–6, 7–8, 8–9, 9–10.',
    '2022-2': 'Stufe 5 und 6 teilen sich das 1. Band, und die Küche bekommt beide Jahrgänge. Weit über der Kapazität, steht so in der Zuordnung.',
    '2022-3': 'Letztes Siebdruck. Fr. Sieb räumt Druck-2. Die Teilung der Bänder bleibt.',
    '2023-1': 'Meisterin Vogt übernimmt Holz und Möbelbau und zieht Stufe 5, 6 und 7 in ein gemeinsames 1. Band. Musikwerkstatt startet. Stufe 10 hat das 4. Band für sich.',
    '2023-2': 'Wieder Paare: 5–6, 7–8, 8–9, 9–10. Schülerzeitung bringt die Sommerausgabe.',
    '2023-3': 'Letzte Schülerzeitung. Dieselben geteilten Bänder, niemand setzt aus.',
    '2024-1': 'Coding & Apps startet. Fr. Teig übernimmt die Küche. Stufe 9 ist im Austausch. Das 4. Band teilen sich Stufe 8 und 10.',
    '2024-2': 'Stufe 9 ist zurück, wieder bei 8 und bei 10. Robotik hat 10 Plätze. Schach läuft das letzte Schuljahr.',
    '2024-3': 'Herr Zug kündigt das Ende von Schach an. Die vier geteilten Bänder bleiben.',
    '2025-1': 'Schach ist archiviert. Upcycling startet für die Bänder von Stufe 9 und 10. Film & Medien auf 8, Garten auf 16.',
    '2025-2': 'Prüfungswochen, ein Band fällt aus. Stufe 5, 6 und 7 teilen sich das 1. Band. 8 mit 9, 9 mit 10 bleiben.',
    '2025-3': 'Vier Bänder wieder wie im Herbst. Letztes vollständig zugeordnetes Trimester in diesem Schuljahr.',
    '2026-1': 'Neues Jahr, dieselbe Teilung: 5 mit 6, 6 mit 7, 8 mit 9, 9 mit 10. Upcycling bleibt bei den älteren Bändern.',
    '2026-2': 'Letzte abgeschlossene Wahl, die Jahrgänge teilen sich die Bänder wie im Herbst. Trimester 3 ist geplant, der Upload fehlt.',
  };
  return stories[`${tr.year}-${tr.trimester}`] || 'Wahl und Zuordnung für dieses Trimester.';
}

function bandVariantOverride(name, bandIndex) {
  const table = {
    'Textil & Nähen': {
      0: { room: 'Näh-2', capacity: 14 },
      1: { room: 'Näh-1', capacity: 8 },
    },
    'Theater & Bühne': {
      0: { room: 'Aula', capacity: 16, teacher: 'Herr Dramaturg' },
      1: { room: 'Proberaum', capacity: 10, teacher: 'Fr. Souffleuse' },
      2: { room: 'Aula', capacity: 16, teacher: 'Herr Dramaturg' },
    },
    'Film Grundlagen': {
      0: { room: 'Studio 7', capacity: 10, teacher: 'Fr. Kamera' },
      1: { room: 'Studio 7', capacity: 10, teacher: 'Fr. Kamera' },
      2: { room: 'Studio 8', capacity: 8, teacher: 'Fr. Kamera' },
      3: { room: 'Schnitt-1', capacity: 8, teacher: 'Herr Schnitt' },
    },
    'Film Vertiefung': {
      2: { room: 'Studio 9', capacity: 8, teacher: 'Herr Schnitt' },
      3: { room: 'Schnitt-1', capacity: 6, teacher: 'Herr Schnitt' },
    },
    'Robotik Lab': {
      1: { room: 'PC-Raum', capacity: 8, teacher: 'Dr. Servo' },
      2: { room: 'MINT-404', capacity: 6, teacher: 'Dr. Servo' },
      3: { room: 'Roboterhalle', capacity: 6, teacher: 'Dr. Servo' },
    },
    'Druck & Grafik': {
      1: { room: 'Druck-1', capacity: 8, teacher: 'Herr Raster' },
      2: { room: 'Druck-2', capacity: 6, teacher: 'Fr. Sieb' },
      3: { room: 'Druck-3', capacity: 8, teacher: 'Herr Raster' },
    },
    'Möbelbau': {
      2: { room: 'Werk-H2', capacity: 6 },
      3: { room: 'Montage', capacity: 4 },
    },
    'Computer-AG': {
      0: { room: 'PC-Raum', capacity: 12, teacher: 'Herr Platine' },
      1: { room: 'PC-Raum', capacity: 12, teacher: 'Herr Platine' },
      2: { room: 'Bibliothek', capacity: 8, teacher: 'Herr Platine' },
    },
    Upcycling: {
      2: { room: 'Werk-H3', capacity: 12, teacher: 'Herr Fund' },
      3: { room: 'Werk-H4', capacity: 8, teacher: 'Herr Fund' },
    },
  };
  return table[name]?.[bandIndex] || null;
}

function buildPlans() {
  const plans = {};
  TRIMESTERS.forEach(tr => {
    const key = slotKey(tr.year, tr.trimester);
    const count = bandCount(tr.year, tr.trimester);
    const bandIds = BAND_IDS.slice(0, count);
    const courses = {};
    COURSES.forEach(course => {
      const offered = offeredInYear(course, tr.year);
      const indexes = offered ? bandsOffered(course, tr.year, tr.trimester) : [];
      const currentCapacity = valueAt(course.capacity, LAST_YEAR);
      const currentTeacher = valueAt(course.teacher, LAST_YEAR);
      const currentRoom = valueAt(course.room, LAST_YEAR);
      const capacity = valueAt(course.capacity, tr.year);
      const teacher = valueAt(course.teacher, tr.year);
      const room = valueAt(course.room, tr.year);
      const stillRunning = isActive(course);
      const stored = (extraValue, yearValue, currentValue) => {
        const value = extraValue != null ? extraValue : yearValue;
        if (stillRunning && value === currentValue) return null;
        return value;
      };
      const groups = new Map();
      indexes.forEach(bandIndex => {
        const extra = bandVariantOverride(course.name, bandIndex) || {};
        const entry = {
          capacity: stored(extra.capacity, capacity, currentCapacity),
          teacher: stored(extra.teacher, teacher, currentTeacher),
          room: stored(extra.room, room, currentRoom),
        };
        const groupKey = `${entry.room}|${entry.teacher}|${entry.capacity}`;
        if (!groups.has(groupKey)) groups.set(groupKey, { ...entry, bandIds: [] });
        groups.get(groupKey).bandIds.push(BAND_IDS[bandIndex]);
      });
      const variants = [...groups.values()].map((group, index) => ({
        id: `v_${course.name}_${index}`,
        bandIds: group.bandIds,
        capacity: group.capacity,
        teacher: group.teacher,
        room: group.room,
        color: null,
      }));
      courses[course.name] = {
        enabled: offered && indexes.length > 0,
        variants,
      };
    });
    plans[key] = {
      key,
      schoolYearStart: tr.year,
      schoolYearEnd: tr.year + 1,
      trimester: tr.trimester,
      bandCount: count,
      wahlCount: 2,
      bandSubtitles: subtitles(tr.year, tr.trimester),
      stufenBandAccess: bandAccess(tr.year, tr.trimester),
      courses,
      notes: planNotes(tr),
      createdAt: timestampFor(tr.year, tr.trimester),
      updatedAt: timestampFor(tr.year, tr.trimester),
    };
  });
  return plans;
}

function validate() {
  const active = COURSES.filter(isActive);
  const archived = COURSES.filter(course => !isActive(course));
  if (students.length < 160) throw new Error(`expected a large cohort, got ${students.length}`);
  if (TRIMESTERS.length !== 30) throw new Error(`expected 30 trimesters, got ${TRIMESTERS.length}`);
  if (!TRIMESTERS[TRIMESTERS.length - 1].open) throw new Error('newest trimester must stay without an upload');
  TRIMESTERS.forEach((tr, index) => {
    const count = bandCount(tr.year, tr.trimester);
    for (let bandIndex = 0; bandIndex < count; bandIndex += 1) {
      if (!coursesOnBand(tr.year, bandIndex, tr.trimester).length) {
        throw new Error(`no courses on ${tr.year} band ${bandIndex}`);
      }
    }
    if (tr.open) {
      if (assignments[index]) throw new Error('open trimester has assignments');
      return;
    }
    students.forEach(student => {
      const row = assignments[index][student.name];
      const should = votesInYear(student, tr.year, tr.trimester);
      if (should && !row) throw new Error(`${student.name} missing in ${slotKey(tr.year, tr.trimester)}`);
      if (!should && row) throw new Error(`${student.name} votes outside Stufe 5–10`);
      if (!row) return;
      Object.entries(row).forEach(([bandKey, courseName]) => {
        if (courseName === 'Nicht Zugeordnet') return;
        const offered = coursesOnBand(tr.year, Number(bandKey), tr.trimester).some(course => course.name === courseName);
        if (!offered) throw new Error(`${courseName} not offered in ${tr.year} band ${bandKey}`);
      });
    });
  });
  const rider = students.find(student => student.enrollment === FIRST_COHORT);
  const newest = students.find(student => student.enrollment === LAST_YEAR);
  if (!votesInYear(rider, 2017, 1) || votesInYear(rider, 2017, 2) || !votesInYear(rider, 2017, 3)) {
    throw new Error('2016 cohort should skip only the class trip in 2017 T2');
  }
  if (!votesInYear(rider, 2021, 1) || votesInYear(rider, 2022, 1)) {
    throw new Error('2016 cohort should graduate after Stufe 10 in 2021');
  }
  if (votesInYear(newest, LAST_YEAR - 1, 1) || !votesInYear(newest, LAST_YEAR, 1)) {
    throw new Error('newest cohort should enter only in the last school year');
  }
  TRIMESTERS.forEach(tr => {
    const cohorts = new Set(
      students.filter(student => votesInYear(student, tr.year, tr.trimester)).map(student => student.enrollment)
    );
    if (cohorts.size > 6) throw new Error(`${slotKey(tr.year, tr.trimester)} has ${cohorts.size} jahrgänge`);
  });
  const full = new Set(students.filter(student => votesInYear(student, 2021, 1)).map(student => student.enrollment));
  if (full.size !== 6) throw new Error(`2021 T1 should show six jahrgänge, got ${full.size}`);
  let sharedTrimesters = 0;
  TRIMESTERS.forEach(tr => {
    const skip = new Set(skippedStufen(tr.year, tr.trimester));
    const shared = plannedBands(tr.year, tr.trimester).some(stufen => stufen.filter(stufe => !skip.has(stufe)).length >= 2);
    if (shared) sharedTrimesters += 1;
  });
  if (sharedTrimesters < 24) throw new Error(`expected most trimesters to share a band, got ${sharedTrimesters}`);
  const plans = buildPlans();
  const robotik = plans['2021-2022 T1']?.courses['Robotik Lab'];
  const robotikRooms = new Set((robotik?.variants || []).map(variant => variant.room));
  if ((robotik?.variants || []).length < 2 || robotikRooms.size < 2) {
    throw new Error('Robotik Lab should have its own room on each band');
  }
  const textilRooms = new Set((plans['2019-2020 T1']?.courses['Textil & Nähen']?.variants || []).map(variant => variant.room));
  if (textilRooms.size < 2) throw new Error('Textil should use a different room per band');
  return { active: active.length, archived: archived.length };
}

async function main() {
  const counts = validate();
  const zip = new JSZip();
  const activeCourses = COURSES.filter(isActive);
  const archivedCourses = COURSES.filter(course => !isActive(course));

  zip.file('students.csv', toCsv([['Name'], ...students.map(student => [student.name])]));
  zip.file('workshops.csv', toCsv([
    ['WorkshopName', 'Capacity', 'AvailableBands'],
    ...activeCourses.map(course => [
      course.name,
      valueAt(course.capacity, LAST_YEAR),
      bandsOffered(course, LAST_YEAR).map(index => BAND_IDS[index]).join(', '),
    ]),
  ]));
  zip.file('archived-workshops.csv', toCsv([
    ['Workshop', 'Capacity', 'AvailableBands', 'ArchivedAt'],
    ...archivedCourses.map(course => [
      course.name,
      valueAt(course.capacity, course.to),
      valueAt(course.bands, course.to).map(index => BAND_IDS[index]).join(', '),
      `${course.to + 1}-08-01T08:00:00.000Z`,
    ]),
  ]));
  zip.file('workshop-colors.csv', toCsv([
    ['Workshop', 'Color'],
    ...COURSES.map(course => [course.name, course.color]),
  ]));
  zip.file('workshop-teachers.csv', toCsv([
    ['Workshop', 'Teacher'],
    ...COURSES.map(course => [course.name, valueAt(course.teacher, isActive(course) ? LAST_YEAR : course.to)]),
  ]));
  zip.file('workshop-rooms.csv', toCsv([
    ['Workshop', 'Room'],
    ...COURSES.map(course => [course.name, valueAt(course.room, isActive(course) ? LAST_YEAR : course.to)]),
  ]));
  zip.file('prerequisites.csv', toCsv([
    ['Workshop', 'RequiredCourses'],
    ['Möbelbau', 'Holzwerkstatt'],
    ['Film Vertiefung', 'Film Grundlagen'],
  ]));
  zip.file('cannot-be-parallel.csv', toCsv([
    ['Workshop', 'CannotBeParallelWith'],
    ['Film & Medien', 'Theater & Bühne'],
    ['Theater & Bühne', 'Film & Medien'],
  ]));
  zip.file('allow-self-parallel.json', JSON.stringify({
    'Garten & Natur': true,
    'Theater & Bühne': true,
  }, null, 2));
  zip.file('rules.csv', toCsv([
    ['RuleType', 'RuleName', 'Options', 'FromCourse', 'ToCourse', 'SameBand', 'Duration', 'MinCount', 'Description', 'KlassenStufen', 'EinschulungVon', 'EinschulungBis'],
    ['belegung', 'Handwerk-Basis (Holz oder Textil)', 'Holzwerkstatt, Textil & Nähen', '', '', 'false', '', '', '', '5-7', '', ''],
    ['mindestbelegung', 'MINT & Medien (mind. 2)', 'Film & Medien, Robotik Lab, Druck & Grafik, Film Grundlagen, Computer-AG, Coding & Apps', '', '', 'false', '', '2', '', '8-10', '', ''],
    ['belegung', 'Digital früher (Computer oder Robotik)', 'Computer-AG, Robotik Lab', '', '', 'false', '', '', '', '6-8', '2012', '2018'],
    ['folgekurs', 'Film Grundlagen → Vertiefung', '', 'Film Grundlagen', 'Film Vertiefung', 'true', '', '', '', '6-10', '', ''],
    ['folgekurs', 'Holz → Möbelbau', '', 'Holzwerkstatt', 'Möbelbau', 'false', '', '', '', '8-10', '2016', ''],
    ['freitext', 'Elterngespräch', '', '', '', 'false', '', '', 'Gespräch zur Werkstattwahl dokumentieren.', '5-10', '', ''],
  ]));
  zip.file('student-enrollment-years.csv', toCsv([
    ['Student', 'EnrollmentYear'],
    ...students.map(student => [student.name, String(student.enrollment)]),
  ]));
  zip.file('student-classes.csv', toCsv([
    ['Student', 'Class'],
    ...students.map(student => [student.name, currentClass(student)]),
  ]));
  zip.file('student-comments.csv', toCsv([
    ['Student', 'Comment'],
    ...students.map(student => [student.name, commentFor(student)]),
  ]));
  zip.file('student-assistants.csv', toCsv([
    ['Student', 'NeedsAssistance'],
    ...students.filter(student => student.assistant).map(student => [student.name, 'Ja']),
  ]));
  zip.file('priority-scores.csv', toCsv([
    ['Student', 'PriorityScore'],
    ...students.map(student => [student.name, String(student.priority)]),
  ]));

  const classes = [];
  for (let stufe = 5; stufe <= 10; stufe += 1) {
    classes.push(`${stufe}a`, `${stufe}b`);
  }
  zip.file('class-registry.json', JSON.stringify(classes, null, 2));
  zip.file('klassenstufen-pool.json', JSON.stringify([5, 6, 7, 8, 9, 10], null, 2));
  zip.file('trimester-plans.json', JSON.stringify(buildPlans(), null, 2));

  let voteFiles = 0;
  let voteRows = 0;
  TRIMESTERS.forEach((tr, index) => {
    if (tr.open) return;
    const key = slotKey(tr.year, tr.trimester);
    const count = bandCount(tr.year, tr.trimester);
    const access = bandAccess(tr.year, tr.trimester);
    const headers = ['Student', ...BAND_HEADERS.slice(0, count), 'Timestamp'];
    const rows = [headers];
    const voters = students.filter(student => assignments[index][student.name]);
    voters.forEach(student => {
      const row = [student.name];
      for (let bandIndex = 0; bandIndex < count; bandIndex += 1) {
        const value = assignments[index][student.name][bandIndex];
        row.push(value || '');
      }
      row.push(timestampFor(tr.year, tr.trimester));
      rows.push(row);
    });
    zip.file(`assignments/${key}.csv`, toCsv(rows));

    for (let bandIndex = 0; bandIndex < count; bandIndex += 1) {
      const bandId = BAND_IDS[bandIndex];
      const offered = coursesOnBand(tr.year, bandIndex, tr.trimester).map(course => course.name);
      const choiceRows = [['Student', 'Klasse', 'Wahl 1', 'Wahl 2']];
      voters.forEach(student => {
        const stufe = formulaStufe(student, tr.year);
        if (!(access[stufe] || []).includes(bandId)) return;
        const assigned = assignments[index][student.name][bandIndex];
        const seed = hashSeed(student.name, tr.year * 3 + tr.trimester, bandIndex);
        const keep = assigned && assigned !== 'Nicht Zugeordnet' && seed % 5 < 2 && offered.includes(assigned);
        const wahl1 = keep ? assigned : offered[seed % offered.length];
        let wahl2 = offered[(seed + 3) % offered.length];
        if (wahl2 === wahl1) wahl2 = offered.find(name => name !== wahl1) || wahl1;
        choiceRows.push([student.name, classNameAt(student, tr.year), wahl1, wahl2]);
      });
      if (choiceRows.length > 1) {
        zip.file(`choices/${key}_${bandId}.csv`, toCsv(choiceRows));
        voteFiles += 1;
        voteRows += choiceRows.length - 1;
      }
    }
  });

  const openKey = slotKey(LAST_YEAR, 3);
  zip.file('README-demo.txt', `Werkstatt-Verwaltung — Demo über 10 Schuljahre
================================================
Import: Daten → ZIP importieren
Datei: werkstatt-demo-10-jahre.zip
Die kleine Demo (werkstatt-demo.zip) bleibt daneben liegen.

Zeitraum: ${FIRST_YEAR}/${FIRST_YEAR + 1} T1 bis ${LAST_YEAR}/${LAST_YEAR + 1} T3 (${TRIMESTERS.length} Trimester)
Schüler: ${students.length} (${STUDENTS_PER_COHORT} je Einschulungsjahr ${FIRST_COHORT}–${LAST_YEAR})
Aktive Werkstätten: ${counts.active}
Archivierte Werkstätten: ${counts.archived}

2017/18 starten Stufe 5 und 6 im selben Band. Neue Stufen kommen dazu, ohne dass jede Stufe ein eigenes Band bekommt.
Die meisten Bänder gehören zwei Jahrgängen, manchmal dreien. Ab 2021/22 sind sechs Jahrgänge da (Stufe 5 bis 10),
auf vier geteilten Bändern. Wer noch nicht in Stufe 5 ist oder schon abgeschlossen hat, steht in keinem Band.

Drei Aussetzer, nur für das eine Trimester:
2017/18 T2 Stufe 6 (Klassenfahrt), 2021/22 T2 Stufe 8 (Praktikum), 2024/25 T1 Stufe 9 (Austausch).
2018/19 T2 fällt der Schulgarten wegen eines Wasserrohrbruchs aus, und Stufe 7 wählt mit den Jüngeren.
2025/26 T2 fallen die Prüfungswochen auf ein Band, Stufe 5 bis 7 teilen sich das erste.

Die Notiz jedes Trimesters erzählt, wer sich ein Band teilt und was sich an den Kursen geändert hat.
Kurse, die wegfallen, stehen in archived-workshops.csv
(Fotolabor, Computer-AG, Schulgarten, Töpfern, Siebdruck, Holz Grundlagen, Nähen Einsteiger, Schülerzeitung, Schach & Strategie).

${openKey} ist nur geplant: Bänder, Stufen und Kurse stehen.
Keine Zuordnungsdatei und keine Wahl-CSV. Der Upload fehlt noch.
Alle früheren Trimester haben Zuordnung und Wahl-Upload (${voteFiles} Wahl-Dateien, ${voteRows} Zeilen).
`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'werkstatt-demo-10-jahre.zip');
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outPath, buffer);
  console.log(`Demo-ZIP: ${outPath}`);
  console.log(`${students.length} Schüler, ${TRIMESTERS.length} Trimester, ${counts.active} aktive Kurse, ${counts.archived} archiviert`);
  console.log(`${openKey} ohne Wahl-Upload. ${voteFiles} Wahl-Dateien für die früheren Trimester.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
