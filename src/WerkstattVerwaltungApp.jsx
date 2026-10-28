import React, { useEffect, useState, useMemo, useRef, useCallback, useId } from "react";
import JSZip from "jszip";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import ColumnMappingModal from "./components/ColumnMappingModal";
import TrimesterManagementPanel from "./components/TrimesterManagementPanel";
import {
  normalizeTrimesterPlans,
  buildInferredTrimesterPlans,
  getPlanBandIds,
  resolveTrimesterWorkshopMeta,
  isWorkshopOfferedInBand,
  plansAsSortedList,
  getTrimesterWahlCount,
} from "./trimesterPlans";
import { isStudentExpectedToVoteOnBand } from "./studentFlowHelpers";

// WerkstattVerwaltungApp.jsx
// Single-file React app (Tailwind CSS assumed) providing an administrative GUI
// - Students searchable list and detail view
// - Wahl/assignment tab with simulated file upload, auto-assignment, drag-and-drop reassign
// - Werkstatt (workshop) management tab (capacity edit, add, delete)
// - Regeln tab for minimum-course requirements ("within 3 years" rules, with OR-options)
// - NEW: per-student flag `persoenlicherAssistent` (personal assistant needed)
// - NEW: improved history overview per student (which course in which year/trimester) and
//        direct inline editing of historical assignments (edits are persisted).
// - NEW: Priority scoring system (1-10) that adjusts based on assignment satisfaction
// - NEW: Workshop color coding with visual indicators throughout the app
// PERSISTENCE: 
//   - Primary: localStorage (fast, persistent)
//   - Backup: CSV format stored in localStorage (recovery if data is deleted)
//   - Each year/trimester assignment saved as separate CSV entry
//   - Auto-export: All changes trigger CSV backup creation
//   - Recovery: If primary data deleted, CSV backups are automatically restored

// NOTE: This file is shipped as a single-file demo component. In a real app split into modules.

// ----------------------------
// No initial data - app starts empty
// ----------------------------

// ----------------------------
// Band configuration (max 6 bands, configurable count per trimester)
// ----------------------------
const BANDS = [
  { id: 'erstesBand', label: 'Erstes Band', shortLabel: '1. Band', number: 1 },
  { id: 'zweitesBand', label: 'Zweites Band', shortLabel: '2. Band', number: 2 },
  { id: 'drittesBand', label: 'Drittes Band', shortLabel: '3. Band', number: 3 },
  { id: 'viertesBand', label: 'Viertes Band', shortLabel: '4. Band', number: 4 },
  { id: 'fuenftesBand', label: 'Fünftes Band', shortLabel: '5. Band', number: 5 },
  { id: 'sechstesBand', label: 'Sechstes Band', shortLabel: '6. Band', number: 6 },
];
const MAX_BANDS = BANDS.length;
const DEFAULT_BAND_COUNT = 2;
const ALL_BAND_IDS = BANDS.map(b => b.id);
const DEFAULT_BAND_IDS = ALL_BAND_IDS.slice(0, DEFAULT_BAND_COUNT);

function getBandIds(count = DEFAULT_BAND_COUNT) {
  const n = Math.min(Math.max(1, count || DEFAULT_BAND_COUNT), MAX_BANDS);
  return ALL_BAND_IDS.slice(0, n);
}

function getBandLabel(bandId) {
  return BANDS.find(b => b.id === bandId)?.label || bandId;
}

function getBandShortLabel(bandId) {
  return BANDS.find(b => b.id === bandId)?.shortLabel || bandId;
}

function createEmptyBandMap() {
  const map = {};
  ALL_BAND_IDS.forEach(id => { map[id] = {}; });
  return map;
}

function createEmptyChoicesMap() {
  return createEmptyBandMap();
}

function createStudentBandAssignments(studentList, bandIds = DEFAULT_BAND_IDS) {
  const assignments = createEmptyBandMap();
  bandIds.forEach(bandId => {
    studentList.forEach(student => {
      assignments[bandId][student] = undefined;
    });
  });
  return assignments;
}

function isLegacySingleBandAssignments(assignments) {
  if (!assignments || typeof assignments !== 'object') return false;
  return !ALL_BAND_IDS.some(id => assignments[id] !== undefined && typeof assignments[id] === 'object');
}

function isMultiBandPayload(payload) {
  if (!payload?.assignments) return false;
  if (Array.isArray(payload.bands) && payload.bands.length > 0) return true;
  return ALL_BAND_IDS.some(id => payload.assignments[id] && typeof payload.assignments[id] === 'object');
}

function getPayloadBandIds(payload) {
  if (payload?.bands && Array.isArray(payload.bands) && payload.bands.length > 0) {
    return payload.bands.filter(id => ALL_BAND_IDS.includes(id));
  }
  if (payload?.assignments) {
    const found = ALL_BAND_IDS.filter(id =>
      payload.assignments[id] && typeof payload.assignments[id] === 'object'
    );
    if (found.length > 0) return found;
    if (isLegacySingleBandAssignments(payload.assignments)) {
      return [ALL_BAND_IDS[0]];
    }
  }
  return [...DEFAULT_BAND_IDS];
}

function normalizeBandDataObject(data) {
  const normalized = createEmptyBandMap();
  if (!data) return normalized;
  ALL_BAND_IDS.forEach(id => {
    if (data[id] && typeof data[id] === 'object') {
      normalized[id] = { ...data[id] };
    }
  });
  return normalized;
}

function isNotAssigned(assignment) {
  if (!assignment) return true;
  const normalized = String(assignment).toLowerCase().trim();
  return normalized.includes('nicht') && normalized.includes('zugeordn');
}

function hasAnyAssignmentInBands(assignments, bandIds) {
  return bandIds.some(bandId =>
    Object.values(assignments[bandId] || {}).some(
      assignment => assignment && assignment !== undefined && !isNotAssigned(assignment)
    )
  );
}

function hasAnyChoicesInBands(choices, bandIds) {
  return bandIds.some(bandId => Object.keys(choices[bandId] || {}).length > 0);
}

function getAssignmentCsvHeaders(bandIds = DEFAULT_BAND_IDS) {
  return ['Student', ...bandIds.map(id => getBandLabel(id).replace(/ /g, '')), 'Timestamp'];
}

function buildStudentReportRows(student, assignments, bandIds, rooms, teachers) {
  return bandIds.map((bandId, index) => {
    const workshop = assignments[bandId]?.[student] || 'Nicht zugeordnet';
    const room = workshop !== 'Nicht zugeordnet' ? (rooms[workshop] || 'N/A') : '-';
    const teacher = workshop !== 'Nicht zugeordnet' ? (teachers[workshop] || 'N/A') : '-';
    return [index === 0 ? student : '', getBandShortLabel(bandId), workshop, room, teacher];
  });
}

function computeBandStatistics(assignments, choices, bandIds) {
  const perBand = {};
  let totalFirst = 0;
  let totalSecond = 0;
  let totalAssignments = 0;

  bandIds.forEach(bandId => {
    let num1 = 0;
    let num2 = 0;
    let total = 0;
    Object.entries(assignments[bandId] || {}).forEach(([student, assignedWorkshop]) => {
      const studentChoices = choices[bandId]?.[student] || [];
      if (studentChoices.length > 0 && assignedWorkshop && !isNotAssigned(assignedWorkshop)) {
        total++;
        if (assignedWorkshop === studentChoices[0]) num1++;
        else if (studentChoices.length > 1 && assignedWorkshop === studentChoices[1]) num2++;
      }
    });
    perBand[bandId] = {
      num1,
      num2,
      total,
      percentFirst: total > 0 ? (num1 / total) * 100 : 0,
    };
    totalFirst += num1;
    totalSecond += num2;
    totalAssignments += total;
  });

  return {
    percentFirst: totalAssignments > 0 ? (totalFirst / totalAssignments) * 100 : 0,
    totalFirst,
    totalSecond,
    perBand,
  };
}

function applyPriorityScoreChangeForStudent(assignments, choices, bandIds, student, currentScore) {
  let totalChange = 0;
  let bandsProcessed = 0;

  bandIds.forEach(bandId => {
    const assigned = assignments[bandId]?.[student];
    const studentChoices = choices[bandId]?.[student] || [];
    const change = processPriorityChangeForBand(assigned, studentChoices);
    if (change !== null) {
      totalChange += change;
      bandsProcessed++;
    }
  });

  if (bandsProcessed === 0) return currentScore;
  const averageChange = totalChange / bandsProcessed;
  const newScore = currentScore + averageChange;
  return Math.max(1, Math.min(10, Math.round(newScore * 10) / 10));
}

function processPriorityChangeForBand(assigned, studentChoices) {
  if (studentChoices.length === 0 || !assigned || isNotAssigned(assigned)) {
    return null;
  }
  const gotFirstChoice = assigned === studentChoices[0];
  const gotSecondChoice = assigned === studentChoices[1];
  if (gotFirstChoice || gotSecondChoice) return -1;
  return studentChoices.length >= 2 ? 1.5 : 1;
}

// ----------------------------
// Workshop Data Structure Helpers
// ----------------------------
// Workshops can be stored as: { name: capacity } (old format) or { name: { capacity: number, availableBands: ['erstesBand', 'zweitesBand'] } } (new format)
function getWorkshopCapacity(workshop, workshopName) {
  if (typeof workshop === 'number') {
    return workshop; // Old format
  }
  if (workshop && typeof workshop === 'object' && 'capacity' in workshop) {
    return workshop.capacity;
  }
  return 0;
}

function getWorkshopAvailableBands(workshop, workshopName) {
  if (typeof workshop === 'number') {
    // Old format: assume available in both bands
    return ['erstesBand', 'zweitesBand'];
  }
  if (workshop && typeof workshop === 'object' && 'availableBands' in workshop) {
    return workshop.availableBands || ['erstesBand', 'zweitesBand'];
  }
  // Default: available in both bands
  return ['erstesBand', 'zweitesBand'];
}

function isWorkshopAvailableInBand(workshops, workshopName, band) {
  const workshop = workshops[workshopName];
  if (!workshop) return false;
  const availableBands = getWorkshopAvailableBands(workshop, workshopName);
  return availableBands.includes(band);
}

function normalizeWorkshopData(workshops) {
  // Convert old format to new format
  const normalized = {};
  Object.keys(workshops).forEach(name => {
    const value = workshops[name];
    if (typeof value === 'number') {
      // Old format: convert to new format
      normalized[name] = {
        capacity: value,
        availableBands: ['erstesBand', 'zweitesBand']
      };
    } else if (value && typeof value === 'object') {
      // New format: ensure it has all required fields
      normalized[name] = {
        capacity: value.capacity || 0,
        availableBands: value.availableBands || ['erstesBand', 'zweitesBand']
      };
    }
  });
  return normalized;
}

function buildPriorityHistoryEntries(student, confirmedAssignments, lastChanged) {
  const historyEntries = [];
  Object.entries(confirmedAssignments).forEach(([slotKey, payload]) => {
    if (!payload.timestamp) return;
    if (lastChanged && payload.timestamp < lastChanged) return;
    if (isMultiBandPayload(payload)) {
      const bandIds = getPayloadBandIds(payload);
      const bandAssignments = {};
      bandIds.forEach(bandId => {
        bandAssignments[bandId] = payload.assignments[bandId]?.[student];
      });
      historyEntries.push({ slotKey, bandIds, bandAssignments, timestamp: payload.timestamp });
    } else {
      historyEntries.push({
        slotKey,
        bandIds: [ALL_BAND_IDS[0]],
        bandAssignments: { [ALL_BAND_IDS[0]]: payload.assignments?.[student] },
        timestamp: payload.timestamp,
      });
    }
  });
  historyEntries.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  return historyEntries;
}

function applyHistoryEntryScoreChange(entry, student, currentScore, loadFn) {
  const choicesKey = `wv_choices_${entry.slotKey}`;
  const trimesterChoices = loadFn(choicesKey, createEmptyChoicesMap());
  let totalChange = 0;
  let bandsProcessed = 0;

  entry.bandIds.forEach(bandId => {
    const assigned = entry.bandAssignments[bandId];
    const studentChoices = trimesterChoices[bandId]?.[student] || [];
    const change = processPriorityChangeForBand(assigned, studentChoices);
    if (change !== null) {
      totalChange += change;
      bandsProcessed++;
    }
  });

  if (bandsProcessed === 0) return currentScore;
  const averageChange = totalChange / bandsProcessed;
  const newScore = currentScore + averageChange;
  return Math.max(1, Math.min(10, newScore));
}

function computePriorityScoreFromFullHistory(student, confirmedAssignments, loadFn, studentAssistants = {}) {
  if (studentAssistants[student]) return 10;
  let score = 5;
  const entries = buildPriorityHistoryEntries(student, confirmedAssignments, null);
  entries.forEach(entry => {
    score = applyHistoryEntryScoreChange(entry, student, score, loadFn);
  });
  return Math.round(score * 10) / 10;
}

function computePriorityScoreHistorySeries(student, confirmedAssignments, loadFn, studentAssistants = {}) {
  const entries = buildPriorityHistoryEntries(student, confirmedAssignments, null);
  if (studentAssistants[student]) {
    return entries.map(entry => ({ score: 10, timestamp: entry.timestamp }));
  }
  let score = 5;
  const series = [];
  entries.forEach(entry => {
    score = applyHistoryEntryScoreChange(entry, student, score, loadFn);
    series.push({ score: Math.round(score * 10) / 10, timestamp: entry.timestamp });
  });
  return series;
}

function getWorkshopStudentsByBand(assignments, workshopName, bandIds) {
  const result = {};
  bandIds.forEach(bandId => {
    result[bandId] = Object.entries(assignments[bandId] || {})
      .filter(([, assignment]) => assignment === workshopName)
      .map(([student]) => student)
      .sort((a, b) => a.localeCompare(b));
  });
  return result;
}

function appendWorkshopBandExcelSections(tableData, studentsByBand, bandIds, studentClasses, studentAssistants, studentComments) {
  let anyStudents = false;
  bandIds.forEach(bandId => {
    const bandStudents = studentsByBand[bandId] || [];
    if (bandStudents.length > 0) {
      anyStudents = true;
      tableData.push([`${getBandLabel(bandId)}:`]);
      tableData.push(['Schüler', 'Klasse', 'Bemerkung', 'Lernbegleitung']);
      bandStudents.forEach(student => {
        const className = studentClasses[student] || 'Unbekannt';
        const needsAssistant = studentAssistants[student] ? 'Ja' : 'Nein';
        const comment = studentComments[student] || '';
        tableData.push([student, className, comment, needsAssistant]);
      });
      tableData.push([]);
    }
  });
  if (!anyStudents) {
    tableData.push(['Keine Schüler zugeordnet']);
  }
}

// localStorage keys
const LS_KEYS = {
  students: "wv_students",
  workshops: "wv_workshops",
  prevAssignments: "wv_prevAssignments",
  prereqs: "wv_prereqs",
  cannotBeParallel: "wv_cannotBeParallel", // NEW: map workshop -> [list of workshops that cannot be in parallel in other band]
  assignments: "wv_assignments", // current confirmed assignments (grouped by year-trimester)
  rules: "wv_rules",
  studentTrimesters: "wv_studentTrimesters",
  studentAssistants: "wv_studentAssistants", // NEW: map student -> boolean
  studentClasses: "wv_studentClasses", // NEW: map student -> class name
  studentEnrollmentYears: "wv_studentEnrollmentYears", // student -> Einschulungsjahr (number)
  classRegistry: "wv_classRegistry", // known class names for pickers
  klassenStufenPool: "wv_klassenStufenPool", // grade levels shown when configuring rules (e.g. 5, 6, 7)
  studentClassUploadInfo: "wv_studentClassUploadInfo", // student -> { trimesterKey, className, uploads[] } from Wahl-Dateien
  allowSelfParallel: "wv_allowSelfParallel", // workshop -> true, wenn der Kurs parallel zu sich selbst erlaubt ist
  studentPriorityScores: "wv_studentPriorityScores", // NEW: map student -> priority score (1-10)
  studentPriorityScoresLastChanged: "wv_studentPriorityScoresLastChanged", // NEW: map student -> ISO timestamp of last manual change
  workshopColors: "wv_workshopColors", // NEW: map workshop -> color hex
  studentComments: "wv_studentComments", // NEW: map student -> comment/notes
  manualRuleChecks: "wv_manualRuleChecks", // NEW: map student -> { ruleId: boolean }
  workshopTeachers: "wv_workshopTeachers", // NEW: map workshop -> teacher name
  workshopRooms: "wv_workshopRooms", // NEW: map workshop -> room number
  archivedWorkshops: "wv_archivedWorkshops", // NEW: map workshop -> { capacity, archivedAt }
  trimesterPlans: "wv_trimesterPlans", // trimester definitions (required before Wahl)
};

// CSV storage helpers
// DATA STORAGE ARCHITECTURE:
// - Follows ACID principles (Atomicity, Consistency, Isolation, Durability)
// - Three-tier storage: localStorage (JSON) → CSV backup (localStorage) → Manual export (download)
// - Each year/trimester is stored separately (temporal data segregation)
// - Automatic CSV backup on every change (no data loss)
// - Recovery mechanism: if primary data deleted, CSV backups auto-restore
// - Manual export button: export all data as downloadable CSV files
// - Manual delete button: clear all data and start fresh (with recovery from backups if needed)
const CSV_SEPARATOR = ';'; // Semicolon for German Excel compatibility
const ZIP_EXPORT_VERSION = 2;

function collectChoicesBySlotKeyFromStorage() {
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith('wv_choices_')) {
      out[key.replace('wv_choices_', '')] = normalizeBandDataObject(load(key, createEmptyChoicesMap()));
    }
  }
  return out;
}

function collectChoicesBySlotKeyFromImport(importedData) {
  const out = {};
  Object.keys(importedData || {}).forEach(key => {
    if (key.startsWith('wv_choices_')) {
      out[key.replace('wv_choices_', '')] = normalizeBandDataObject(importedData[key]);
    }
  });
  return out;
}

// School Year Helper Functions
// School years are represented as "YYYY-YYYY T#" format (e.g., "2025-2026 T1", "2026-2028 T3")
// A school year typically runs from September to August, so 2025-2026 means September 2025 to August 2026

// Get default school year based on current date
// If current month is August or earlier, use previous year as start
// If current month is September or later, use current year as start
function getDefaultSchoolYear() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12 (January = 1)
  
  // School year typically starts in September (month 9)
  // If we're in September or later, the school year started this year
  // If we're in August or earlier, the school year started last year
  if (currentMonth >= 9) {
    return { schoolYearStart: currentYear, schoolYearEnd: currentYear + 1 };
  } else {
    return { schoolYearStart: currentYear - 1, schoolYearEnd: currentYear };
  }
}

// Generate key from school year and trimester (format: "YYYY-YYYY T#")
function getSchoolYearKey(schoolYearStart, schoolYearEnd, trimester) {
  return `${schoolYearStart}-${schoolYearEnd} T${trimester}`;
}

// Parse key to extract school year and trimester
// Supports both old format "YYYY-T#" and new format "YYYY-YYYY T#"
function parseSchoolYearKey(key) {
  // Try new format first: "YYYY-YYYY T#"
  const newFormatMatch = key.match(/(\d+)-(\d+)\s+T(\d+)/);
  if (newFormatMatch) {
    return {
      schoolYearStart: parseInt(newFormatMatch[1]),
      schoolYearEnd: parseInt(newFormatMatch[2]),
      trimester: parseInt(newFormatMatch[3])
    };
  }
  
  // Try old format for backward compatibility: "YYYY-T#"
  const oldFormatMatch = key.match(/(\d+)-T(\d+)/);
  if (oldFormatMatch) {
    const year = parseInt(oldFormatMatch[1]);
    return {
      schoolYearStart: year,
      schoolYearEnd: year + 1, // Assume single year represents a school year
      trimester: parseInt(oldFormatMatch[2])
    };
  }
  
  return null;
}

// Get previous trimester key (handles school year transitions)
// If T1, go to previous school year T3
// Otherwise, go to previous trimester in same school year
function getPreviousTrimesterKey(schoolYearStart, schoolYearEnd, currentTrimester) {
  if (currentTrimester === 1) {
    // If T1, go to previous school year T3
    return getSchoolYearKey(schoolYearStart - 1, schoolYearEnd - 1, 3);
  } else {
    // Otherwise, go to previous trimester in same school year
    return getSchoolYearKey(schoolYearStart, schoolYearEnd, currentTrimester - 1);
  }
}

// Storage with CSV auto-export
const save = (key, obj, autoExport = true) => {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
    console.log(`✅ Saved ${key} to localStorage:`, obj);
    if (autoExport && shouldAutoExport(key)) {
      autoExportToCSV(key, obj);
    }
  } catch (error) {
    console.error(`❌ Failed to save ${key}:`, error);
  }
};

const load = (key, fallback) => {
  const raw = localStorage.getItem(key);
  if (!raw) {
    // Try to recover from CSV backup
    const csvBackup = localStorage.getItem(`csv_${key}`);
    if (csvBackup) {
      try {
        const csvData = JSON.parse(csvBackup);
        console.log(`♻️ Recovering ${key} from CSV backup`);
        // Parse CSV data back to original format
        const recovered = parseCSVToData(key, csvData);
        if (recovered) {
          return recovered;
        }
      } catch (e) {
        console.error(`Failed to recover ${key} from CSV:`, e);
      }
    }
    console.log(`📭 No data found for ${key}, using fallback:`, fallback);
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    console.log(`📥 Loaded ${key} from localStorage:`, parsed);
    return parsed;
  } catch (e) {
    console.error(`Failed to load ${key}:`, e);
    return fallback;
  }
};

function parseCSVToData(key, csvData) {
  if (!csvData || csvData.length === 0) return null;
  
  const rows = csvData.slice(1);
  
  try {
    if (key === 'wv_students') {
      return rows.map(row => row[0]);
    } else if (key === 'wv_workshops') {
      const result = {};
      rows.forEach(row => {
        const name = row[0];
        const capacity = parseInt(row[1]) || 0;
        // Support both old format (just capacity) and new format (capacity, availableBands)
        const availableBands = row[2] ? row[2].split(',').map(b => b.trim()).filter(b => b) : ['erstesBand', 'zweitesBand'];
        result[name] = {
          capacity: capacity,
          availableBands: availableBands
        };
      });
      return result;
    } else if (key === 'wv_prevAssignments' || key === 'wv_prereqs' || key === 'wv_cannotBeParallel' || key === 'wv_studentTrimesters' || 
               key === 'wv_studentAssistants' || key === 'wv_studentClasses' || key === 'wv_studentEnrollmentYears' || key === 'wv_studentPriorityScores' || key === 'wv_studentPriorityScoresLastChanged' ||
               key === 'wv_workshopColors' || key === 'wv_studentComments' || key === 'wv_workshopTeachers' || key === 'wv_workshopRooms' || key === 'wv_archivedWorkshops') {
      const result = {};
      rows.forEach(row => {
        if (key === 'wv_studentAssistants') {
          result[row[0]] = row[1] === 'Ja' || row[1] === 'true';
        } else if (key === 'wv_studentEnrollmentYears') {
          const year = parseInt(row[1], 10);
          if (row[0] && Number.isFinite(year)) result[row[0]] = year;
        } else if (key === 'wv_studentTrimesters' || key === 'wv_studentPriorityScores' || key === 'wv_studentPriorityScoresLastChanged' || key === 'wv_studentComments' || 
                   key === 'wv_workshopTeachers' || key === 'wv_workshopRooms') {
          // For comments, teachers, rooms, timestamps, preserve the value as-is (may contain newlines, semicolons, etc.)
          result[row[0]] = row[1] || '';
        } else if (key === 'wv_prereqs' || key === 'wv_cannotBeParallel') {
          result[row[0]] = row[1] ? row[1].split(',').map(s => s.trim()) : [];
        } else if (key === 'wv_archivedWorkshops') {
          const capacity = parseInt(row[1]) || 0;
          const availableBands = row[2] ? row[2].split(',').map(b => b.trim()).filter(b => b) : ['erstesBand', 'zweitesBand'];
          const archivedAt = row[3] || row[2] || new Date().toISOString(); // Support both old format (3 columns) and new format (4 columns)
          result[row[0]] = {
            capacity: capacity,
            availableBands: availableBands,
            archivedAt: archivedAt
          };
        } else {
          result[row[0]] = row[1];
        }
      });
      return result;
    } else if (key === 'wv_rules') {
      return rows.map((row, idx) => {
        const ruleType = row[0] || 'belegung'; // Default to belegung for backward compatibility
        const baseRule = {
          id: Date.now() + Math.random() + idx,
          type: ruleType,
          name: row[1] || '',
          klassenStufenRange: parseKlassenStufenRangeFromCsvCell(row[9]),
          einschulungsjahrFrom: parseOptionalRuleYear(row[10]),
          einschulungsjahrTo: parseOptionalRuleYear(row[11]),
        };
        
        if (ruleType === 'belegung') {
          return {
            ...baseRule,
            options: row[2] ? row[2].split(',').map(s => s.trim()).filter(Boolean) : []
          };
        }
        if (ruleType === 'mindestbelegung') {
          const minCount = parseInt(row[7], 10);
          return {
            ...baseRule,
            options: row[2] ? row[2].split(',').map(s => s.trim()).filter(Boolean) : [],
            minCount: Number.isFinite(minCount) && minCount > 0 ? minCount : 1
          };
        }
        if (ruleType === 'freitext') {
          return {
            ...baseRule,
            description: row[8] || row[2] || ''
          };
        }
        if (ruleType === 'folgekurs') {
          return {
            ...baseRule,
            fromCourse: row[3] || '',
            toCourse: row[4] || '',
            sameBand: row[5] === 'true' || row[5] === 'Ja',
            duration: row[6] ? parseInt(row[6], 10) : undefined
          };
        }
        return baseRule;
      });
    }
  } catch (e) {
    console.error(`Failed to parse CSV for ${key}:`, e);
    return null;
  }
  return null;
}

// Auto-export configuration
const EXPORT_CONFIG = {
  'wv_students': { filename: 'students.csv', headers: ['Name'] },
  'wv_workshops': { filename: 'workshops.csv', headers: ['WorkshopName', 'Capacity', 'AvailableBands'] },
  'wv_prevAssignments': { filename: 'previous-assignments.csv', headers: ['Student', 'Workshop'] },
  'wv_prereqs': { filename: 'prerequisites.csv', headers: ['Workshop', 'RequiredCourses'] },
  'wv_cannotBeParallel': { filename: 'cannot-be-parallel.csv', headers: ['Workshop', 'CannotBeParallelWith'] },
  'wv_rules': { filename: 'rules.csv', headers: ['RuleType', 'RuleName', 'Options', 'FromCourse', 'ToCourse', 'SameBand', 'Duration', 'MinCount', 'Description', 'KlassenStufen', 'EinschulungVon', 'EinschulungBis'] },
  'wv_studentEnrollmentYears': { filename: 'student-enrollment-years.csv', headers: ['Student', 'EnrollmentYear'] },
  'wv_manualRuleChecks': { filename: 'manual-rule-checks.csv', headers: ['Student', 'RuleId', 'Checked'] },
  'wv_studentTrimesters': { filename: 'student-trimesters.csv', headers: ['Student', 'Trimester'] },
  'wv_studentAssistants': { filename: 'student-assistants.csv', headers: ['Student', 'NeedsAssistance'] },
  'wv_studentClasses': { filename: 'student-classes.csv', headers: ['Student', 'Class'] },
  'wv_studentPriorityScores': { filename: 'priority-scores.csv', headers: ['Student', 'PriorityScore'] },
  'wv_studentPriorityScoresLastChanged': { filename: 'priority-scores-last-changed.csv', headers: ['Student', 'LastChanged'] },
  'wv_workshopColors': { filename: 'workshop-colors.csv', headers: ['Workshop', 'Color'] },
  'wv_studentComments': { filename: 'student-comments.csv', headers: ['Student', 'Comment'] },
  'wv_workshopTeachers': { filename: 'workshop-teachers.csv', headers: ['Workshop', 'Teacher'] },
  'wv_workshopRooms': { filename: 'workshop-rooms.csv', headers: ['Workshop', 'Room'] },
  'wv_archivedWorkshops': { filename: 'archived-workshops.csv', headers: ['Workshop', 'Capacity', 'AvailableBands', 'ArchivedAt'] }
};

function shouldAutoExport(key) {
  return key in EXPORT_CONFIG;
}

function autoExportToCSV(key, data) {
  const config = EXPORT_CONFIG[key];
  if (!config) return;
  
  try {
    let csvData = [];
    
        if (Array.isArray(data)) {
          if (config.headers[0] === 'RuleType') {
            // New format: RuleType, RuleName, Options, FromCourse, ToCourse, SameBand
            csvData = data.map(item => ruleToExportRow(item));
          } else if (config.headers[0] === 'RuleName') {
            // Legacy format: RuleName, Options (for backward compatibility)
            csvData = data.map(item => {
              const ruleType = item.type || 'belegung';
              if (ruleType === 'belegung') {
                return [item.name || '', (item.options || []).join(', ')];
              } else {
                // Convert folgekurs to legacy format (not ideal, but for compatibility)
                return [item.name || '', `${item.fromCourse} → ${item.toCourse}`];
              }
            });
          } else if (config.headers[0] === 'Name') {
        csvData = data.map(item => [item]);
      }
    } else if (typeof data === 'object') {
      if (key === 'wv_manualRuleChecks') {
        csvData = [];
        Object.entries(data || {}).forEach(([student, checks]) => {
          Object.entries(checks || {}).forEach(([ruleId, checked]) => {
            if (checked) {
              csvData.push([student, ruleId, 'true']);
            }
          });
        });
      } else if (key === 'wv_workshops') {
        csvData = Object.entries(data).map(([name, workshop]) => {
          const capacity = getWorkshopCapacity(workshop, name);
          const availableBands = getWorkshopAvailableBands(workshop, name);
          return [name, capacity, availableBands.join(', ')];
        });
      } else if (key === 'wv_prevAssignments') {
        csvData = Object.entries(data).map(([student, workshop]) => [student, workshop]);
      } else if (key === 'wv_prereqs' || key === 'wv_cannotBeParallel') {
        csvData = Object.entries(data).map(([workshop, list]) => [workshop, (list || []).join(', ')]);
      } else if (key === 'wv_studentTrimesters') {
        csvData = Object.entries(data).map(([student, trimester]) => [student, trimester]);
      } else if (key === 'wv_studentAssistants') {
        csvData = Object.entries(data).map(([student, needs]) => [student, needs ? 'Ja' : 'Nein']);
      } else if (key === 'wv_studentClasses') {
        csvData = Object.entries(data).map(([student, className]) => [student, className]);
      } else if (key === 'wv_studentEnrollmentYears') {
        csvData = Object.entries(data).map(([student, year]) => [student, String(year)]);
      } else if (key === 'wv_studentPriorityScores') {
        csvData = Object.entries(data).map(([student, score]) => [student, score]);
      } else if (key === 'wv_studentComments') {
        // Properly escape comments for CSV (handle semicolons, quotes, newlines)
        csvData = Object.entries(data).map(([student, comment]) => {
          const commentStr = String(comment || '');
          // Escape quotes by doubling them, wrap in quotes if contains separator, quote, or newline
          const escapedComment = commentStr.replace(/"/g, '""');
          return [student, escapedComment];
        });
      } else if (key === 'wv_workshopColors') {
        csvData = Object.entries(data).map(([workshop, color]) => [workshop, color]);
      } else if (key === 'wv_workshopTeachers') {
        // Properly escape teacher names for CSV
        csvData = Object.entries(data).map(([workshop, teacher]) => {
          const teacherStr = String(teacher || '');
          const escapedTeacher = teacherStr.replace(/"/g, '""');
          return [workshop, escapedTeacher];
        });
      } else if (key === 'wv_workshopRooms') {
        csvData = Object.entries(data).map(([workshop, room]) => [workshop, room || '']);
      } else if (key === 'wv_archivedWorkshops') {
        csvData = Object.entries(data).map(([workshop, info]) => {
          const capacity = info.capacity || 0;
          const availableBands = info.availableBands || ['erstesBand', 'zweitesBand'];
          const archivedAt = info.archivedAt || new Date().toISOString();
          return [workshop, capacity, availableBands.join(', '), archivedAt];
        });
      }
    }
    
    // Add headers
    csvData.unshift(config.headers);
    
    // Save to localStorage as backup (CSV format)
    localStorage.setItem(`csv_${key}`, JSON.stringify(csvData));
    console.log(`✅ Auto-saved CSV backup for ${key}`);
  } catch (error) {
    console.error(`Failed to auto-export ${key}:`, error);
  }
}

// Export assignments to separate files by school year/trimester
function exportAssignment(schoolYearStart, schoolYearEnd, trimester, assignments, bandIds = DEFAULT_BAND_IDS) {
  const key = getSchoolYearKey(schoolYearStart, schoolYearEnd, trimester);
  try {
    const csvData = [];
    csvData.push(getAssignmentCsvHeaders(bandIds));
    
    if (assignments && !isLegacySingleBandAssignments(assignments)) {
      const allStudents = new Set();
      bandIds.forEach(bandId => {
        Object.keys(assignments[bandId] || {}).forEach(s => allStudents.add(s));
      });
      
      allStudents.forEach(student => {
        const row = [student];
        bandIds.forEach(bandId => {
          row.push(assignments[bandId]?.[student] || 'Nicht Zugeordnet');
        });
        row.push(new Date().toISOString());
        csvData.push(row);
      });
    } else {
      Object.entries(assignments || {}).forEach(([student, workshop]) => {
        const row = [student, workshop];
        for (let i = 1; i < bandIds.length; i++) row.push('');
        row.push(new Date().toISOString());
        csvData.push(row);
      });
    }
    
    localStorage.setItem(`csv_assignments_${key}`, JSON.stringify(csvData));
  } catch (error) {
    console.error(`Failed to export assignment ${key}:`, error);
  }
}

// Helper to convert data to CSV string
function dataToCSVString(data, headers) {
  const csvContent = data.map(row => 
    row.map(cell => {
      const cellStr = String(cell || '');
      if (cellStr.includes(';') || cellStr.includes('"') || cellStr.includes('\n')) {
        return '"' + cellStr.replace(/"/g, '""') + '"';
      }
      return cellStr;
    }).join(CSV_SEPARATOR)
  ).join('\r\n');
  
  const BOM = '\uFEFF';
  return BOM + (headers ? headers.join(CSV_SEPARATOR) + '\r\n' : '') + csvContent;
}

// Export all data as ZIP file
async function exportAllDataAsZIP(allData) {
  try {
    const zip = new JSZip();
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: 2025-01-15T14-30-00
    const zipFilename = `werkstatt-data_${timestamp}.zip`;
    
    // Export choices separately by year/trimester (stored with pattern wv_choices_${key})
    // We need to load all choices from localStorage directly (not from LS_KEYS)
    const allChoicesKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('wv_choices_')) {
        allChoicesKeys.push(key);
      }
    }
    
    allChoicesKeys.forEach(choicesKey => {
      try {
        const choicesData = load(choicesKey, createEmptyChoicesMap());
        if (choicesData && hasAnyChoicesInBands(choicesData, ALL_BAND_IDS)) {
          const slotKey = choicesKey.replace('wv_choices_', '');
          
          ALL_BAND_IDS.forEach(bandId => {
            const bandData = [];
            let maxWishes = 2;
            Object.values(choicesData[bandId] || {}).forEach(choices => {
              if (Array.isArray(choices)) maxWishes = Math.max(maxWishes, choices.length);
            });
            const wishHeaders = Array.from({ length: maxWishes }, (_, i) => `Wahl ${i + 1}`);
            bandData.push(['Student', 'Klasse', ...wishHeaders]);
            Object.entries(choicesData[bandId] || {}).forEach(([student, choices]) => {
              if (Array.isArray(choices) && choices.length > 0) {
                const row = [student, choicesData.__classes?.[bandId]?.[student] || ''];
                for (let w = 0; w < maxWishes; w += 1) row.push(choices[w] || '');
                bandData.push(row);
              }
            });
            
            if (bandData.length > 1) {
              zip.file(`choices/${slotKey}_${bandId}.csv`, dataToCSVString(bandData.slice(1), bandData[0]));
            }
          });
        }
      } catch (error) {
        console.error(`Failed to export choices for ${choicesKey}:`, error);
      }
    });
    
    // Export all data types
    Object.entries(LS_KEYS).forEach(([keyName, lsKey]) => {
      if (keyName === 'assignments') {
        // Export assignments separately by year/trimester
        const assignments = allData[lsKey] || {};
        Object.entries(assignments).forEach(([slotKey, data]) => {
          const bandIds = getPayloadBandIds(data);
          const headers = ['Student', ...bandIds.map(id => getBandLabel(id).replace(/ /g, '')), 'Timestamp'];
          const csvData = [headers];
          
          if (data?.assignments && !isLegacySingleBandAssignments(data.assignments)) {
            const allStudents = new Set();
            bandIds.forEach(bandId => {
              Object.keys(data.assignments[bandId] || {}).forEach(s => allStudents.add(s));
            });
            
            allStudents.forEach(student => {
              const row = [student];
              bandIds.forEach(bandId => {
                row.push(data.assignments[bandId]?.[student] || 'Nicht Zugeordnet');
              });
              row.push(data.timestamp || new Date().toISOString());
              csvData.push(row);
            });
          } else if (data?.assignments) {
            Object.entries(data.assignments).forEach(([student, workshop]) => {
              const row = [student, workshop];
              for (let i = 1; i < bandIds.length; i++) row.push('');
              row.push(data.timestamp || new Date().toISOString());
              csvData.push(row);
            });
          }
          
          zip.file(`assignments/${slotKey}.csv`, dataToCSVString(csvData.slice(1), csvData[0]));
        });
      } else {
        const data = allData[lsKey];
        const config = EXPORT_CONFIG[lsKey];
        if (!config || !data) return;
        
        let csvData = [];
        
        if (Array.isArray(data)) {
          if (config.headers[0] === 'RuleType') {
            csvData = data.map(item => ruleToExportRow(item));
          } else if (config.headers[0] === 'RuleName') {
            // Legacy format: RuleName, Options (for backward compatibility)
            csvData = data.map(item => {
              const ruleType = item.type || 'belegung';
              if (ruleType === 'belegung') {
                return [item.name || '', (item.options || []).join(', ')];
              } else {
                // Convert folgekurs to legacy format (not ideal, but for compatibility)
                return [item.name || '', `${item.fromCourse} → ${item.toCourse}`];
              }
            });
          } else if (config.headers[0] === 'Name') {
            csvData = data.map(item => [item]);
          }
        } else if (typeof data === 'object') {
          if (lsKey === 'wv_workshops') {
            csvData = Object.entries(data).map(([name, workshop]) => {
              const capacity = getWorkshopCapacity(workshop, name);
              const availableBands = getWorkshopAvailableBands(workshop, name);
              return [name, capacity, availableBands.join(', ')];
            });
          } else if (lsKey === 'wv_prevAssignments') {
            csvData = Object.entries(data).map(([student, workshop]) => [student, workshop]);
          } else if (lsKey === 'wv_prereqs' || lsKey === 'wv_cannotBeParallel') {
            csvData = Object.entries(data).map(([workshop, list]) => [workshop, (list || []).join(', ')]);
          } else if (lsKey === 'wv_studentTrimesters') {
            csvData = Object.entries(data).map(([student, trimester]) => [student, trimester]);
          } else if (lsKey === 'wv_studentAssistants') {
            csvData = Object.entries(data).map(([student, needs]) => [student, needs ? 'Ja' : 'Nein']);
          } else if (lsKey === 'wv_studentClasses') {
            csvData = Object.entries(data).map(([student, className]) => [student, className]);
          } else if (lsKey === 'wv_studentPriorityScores') {
            csvData = Object.entries(data).map(([student, score]) => [student, score]);
          } else if (lsKey === 'wv_studentPriorityScoresLastChanged') {
            csvData = Object.entries(data).map(([student, timestamp]) => [student, timestamp || '']);
          } else if (lsKey === 'wv_manualRuleChecks') {
            csvData = [];
            Object.entries(data || {}).forEach(([student, checks]) => {
              Object.entries(checks || {}).forEach(([ruleId, checked]) => {
                if (checked) {
                  csvData.push([student, ruleId, 'true']);
                }
              });
            });
          } else if (lsKey === 'wv_studentComments') {
            // Properly escape comments for CSV (handle semicolons, quotes, newlines)
            csvData = Object.entries(data).map(([student, comment]) => {
              const commentStr = String(comment || '');
              // Escape quotes by doubling them, wrap in quotes if contains separator, quote, or newline
              const escapedComment = commentStr.replace(/"/g, '""');
              return [student, escapedComment];
            });
          } else if (lsKey === 'wv_workshopColors') {
            csvData = Object.entries(data).map(([workshop, color]) => [workshop, color]);
          } else if (lsKey === 'wv_workshopTeachers') {
            // Properly escape teacher names for CSV
            csvData = Object.entries(data).map(([workshop, teacher]) => {
              const teacherStr = String(teacher || '');
              const escapedTeacher = teacherStr.replace(/"/g, '""');
              return [workshop, escapedTeacher];
            });
          } else if (lsKey === 'wv_workshopRooms') {
            csvData = Object.entries(data).map(([workshop, room]) => [workshop, room || '']);
          } else if (lsKey === 'wv_archivedWorkshops') {
            // Export archived workshops with all their information
            csvData = Object.entries(data).map(([workshop, info]) => {
              const capacity = info.capacity || 0;
              const archivedAt = info.archivedAt || new Date().toISOString();
              // For archived workshops, we need to reconstruct availableBands if it was stored
              // Since archived workshops might not have this info, we'll default to both bands
              const availableBands = info.availableBands || ['erstesBand', 'zweitesBand'];
              return [workshop, capacity, availableBands.join(', '), archivedAt];
            });
          }
        }
        
        if (csvData.length > 0) {
          zip.file(config.filename, dataToCSVString(csvData, config.headers));
        }
      }
    });

    // JSON payloads (trimester config + registries not covered by CSV EXPORT_CONFIG)
    const trimesterPlans = allData[LS_KEYS.trimesterPlans];
    if (trimesterPlans && Object.keys(trimesterPlans).length > 0) {
      zip.file('trimester-plans.json', JSON.stringify(trimesterPlans, null, 2));
    }
    const classRegistry = allData[LS_KEYS.classRegistry];
    if (Array.isArray(classRegistry) && classRegistry.length > 0) {
      zip.file('class-registry.json', JSON.stringify(classRegistry, null, 2));
    }
    const klassenPool = allData[LS_KEYS.klassenStufenPool];
    if (Array.isArray(klassenPool) && klassenPool.length > 0) {
      zip.file('klassenstufen-pool.json', JSON.stringify(klassenPool, null, 2));
    }
    const classUploadInfo = allData[LS_KEYS.studentClassUploadInfo];
    if (classUploadInfo && Object.keys(classUploadInfo).length > 0) {
      zip.file('student-class-upload-info.json', JSON.stringify(classUploadInfo, null, 2));
    }
    const allowSelfParallel = allData[LS_KEYS.allowSelfParallel];
    if (allowSelfParallel && Object.keys(allowSelfParallel).length > 0) {
      zip.file('allow-self-parallel.json', JSON.stringify(allowSelfParallel, null, 2));
    }

    zip.file(
      'export-manifest.json',
      JSON.stringify(
        {
          exportVersion: ZIP_EXPORT_VERSION,
          exportedAt: new Date().toISOString(),
          includes: {
            csv: Object.values(EXPORT_CONFIG).map(c => c.filename),
            assignments: 'assignments/*.csv',
            choices: 'choices/*.csv',
            trimesterPlans: Boolean(trimesterPlans && Object.keys(trimesterPlans).length),
            classRegistry: Boolean(classRegistry?.length),
            klassenStufenPool: Boolean(klassenPool?.length),
            studentClassUploadInfo: Boolean(classUploadInfo && Object.keys(classUploadInfo).length),
          },
        },
        null,
        2
      )
    );
    
    // Generate ZIP file
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = zipFilename;
    link.click();
    URL.revokeObjectURL(url);
    
    return zipFilename;
  } catch (error) {
    console.error('Failed to export ZIP:', error);
    throw error;
  }
}

// Import data from ZIP file
async function importDataFromZIP(file) {
  try {
    const zip = await JSZip.loadAsync(file);
    const importedData = {};
    
    // Process each file in ZIP
    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      
      const content = await zipEntry.async('string');
      if (!content.trim()) continue;
      
      // Parse CSV - handle multiline values properly
      const data = [];
      const lines = content.split(/\r?\n/);
      let currentRow = [];
      let current = '';
      let inQuotes = false;
      
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          const nextChar = i < line.length - 1 ? line[i + 1] : null;
          
          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              // Escaped quote (doubled quote)
              current += '"';
              i++; // Skip next quote
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
            }
          } else if (char === CSV_SEPARATOR && !inQuotes) {
            // Field separator
            currentRow.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        
        // If we're not in quotes, this line is complete
        if (!inQuotes) {
          // Add the last field
          if (current !== '' || currentRow.length > 0) {
            currentRow.push(current);
            if (currentRow.length > 0 && currentRow.some(f => f.trim() !== '')) {
              data.push(currentRow);
            }
            currentRow = [];
            current = '';
          }
        } else {
          // We're still in quotes, add newline and continue
          current += '\n';
        }
      }
      
      // Handle last row if file doesn't end with newline
      if (current !== '' || currentRow.length > 0) {
        currentRow.push(current);
        if (currentRow.length > 0 && currentRow.some(f => f.trim() !== '')) {
          data.push(currentRow);
        }
      }
      
      if (data.length === 0) continue;

      if (filename === 'trimester-plans.json') {
        try {
          importedData[LS_KEYS.trimesterPlans] = JSON.parse(content);
        } catch (e) {
          console.warn('trimester-plans.json parse failed', e);
        }
        continue;
      }
      if (filename === 'class-registry.json') {
        try {
          importedData[LS_KEYS.classRegistry] = JSON.parse(content);
        } catch (e) {
          console.warn('class-registry.json parse failed', e);
        }
        continue;
      }
      if (filename === 'klassenstufen-pool.json') {
        try {
          importedData[LS_KEYS.klassenStufenPool] = JSON.parse(content);
        } catch (e) {
          console.warn('klassenstufen-pool.json parse failed', e);
        }
        continue;
      }
      if (filename === 'student-class-upload-info.json') {
        try {
          const parsed = JSON.parse(content) || {};
          const current = importedData[LS_KEYS.studentClassUploadInfo] || {};
          Object.entries(parsed).forEach(([student, info]) => {
            if (!info || typeof info !== 'object') return;
            const existing = current[student];
            const uploads = [...(existing?.uploads || [])];
            (info.uploads || []).forEach(entry => {
              if (!uploads.some(item => item.trimesterKey === entry.trimesterKey && item.bandId === entry.bandId)) {
                uploads.push(entry);
              }
            });
            if (!existing) {
              current[student] = uploads.length ? { ...info, uploads } : info;
              return;
            }
            if (!uploads.length) return;
            const latest = [...uploads].sort((a, b) => String(a.trimesterKey).localeCompare(String(b.trimesterKey))).pop();
            current[student] = {
              trimesterKey: latest.trimesterKey,
              className: latest.className,
              uploads,
            };
          });
          importedData[LS_KEYS.studentClassUploadInfo] = current;
        } catch (e) {
          console.warn('student-class-upload-info.json parse failed', e);
        }
        continue;
      }
      if (filename === 'allow-self-parallel.json') {
        try {
          importedData[LS_KEYS.allowSelfParallel] = JSON.parse(content);
        } catch (e) {
          console.warn('allow-self-parallel.json parse failed', e);
        }
        continue;
      }
      if (filename === 'export-manifest.json') {
        continue;
      }
      
      const rows = data.slice(1);
      
      // Determine data type from filename
      if (filename.startsWith('assignments/')) {
        const slotKey = filename.replace('assignments/', '').replace('.csv', '');
        if (!importedData.assignments) importedData.assignments = {};
        
        const assignments = createEmptyBandMap();
        const headerCells = data[0] || [];
        const bandColumns = [];
        headerCells.forEach((header, idx) => {
          if (idx === 0 || idx === headerCells.length - 1) return;
          const normalized = String(header || '').toLowerCase().replace(/\s/g, '');
          const matchedBand = BANDS.find(b =>
            normalized === b.id.toLowerCase() ||
            normalized === b.label.toLowerCase().replace(/\s/g, '') ||
            normalized === b.label.toLowerCase().replace(/\s/g, '').replace('ä', 'ae').replace('ü', 'ue').replace('ö', 'oe')
          );
          if (matchedBand) {
            bandColumns.push({ idx, bandId: matchedBand.id });
          } else if (normalized === 'erstesband' || normalized === '1.band') {
            bandColumns.push({ idx, bandId: 'erstesBand' });
          } else if (normalized === 'zweitesband' || normalized === '2.band') {
            bandColumns.push({ idx, bandId: 'zweitesBand' });
          } else if (normalized === 'drittesband' || normalized === '3.band') {
            bandColumns.push({ idx, bandId: 'drittesBand' });
          } else if (normalized === 'viertesband' || normalized === '4.band') {
            bandColumns.push({ idx, bandId: 'viertesBand' });
          } else if (normalized === 'fuenftesband' || normalized === '5.band') {
            bandColumns.push({ idx, bandId: 'fuenftesBand' });
          } else if (normalized === 'sechstesband' || normalized === '6.band') {
            bandColumns.push({ idx, bandId: 'sechstesBand' });
          }
        });

        if (bandColumns.length === 0) {
          bandColumns.push({ idx: 1, bandId: 'erstesBand' }, { idx: 2, bandId: 'zweitesBand' });
        }

        rows.forEach(row => {
          if (row[0]) {
            bandColumns.forEach(({ idx, bandId }) => {
              if (row[idx]) assignments[bandId][row[0]] = row[idx];
            });
          }
        });
        
        importedData.assignments[slotKey] = {
          assignments,
          timestamp: rows[0]?.[headerCells.length - 1] || rows[0]?.[3] || new Date().toISOString(),
          bands: bandColumns.map(c => c.bandId)
        };
      } else if (filename.startsWith('choices/')) {
        // Import choices for a specific trimester
        // Format: choices/${slotKey}_erstesBand.csv or choices/${slotKey}_zweitesBand.csv
        const choicesFilename = filename.replace('choices/', '').replace('.csv', '');
        const parts = choicesFilename.split('_');
        if (parts.length >= 2) {
          const band = parts[parts.length - 1]; // 'erstesBand' or 'zweitesBand'
          const slotKey = parts.slice(0, -1).join('_'); // Everything before the last underscore
          
          const choicesKey = `wv_choices_${slotKey}`;
          if (!importedData[choicesKey]) {
            importedData[choicesKey] = createEmptyChoicesMap();
          }
          
          const { classIdx, choiceIdxs } = choiceColumnIndexes(data[0]);
          if (!importedData[choicesKey].__classes) importedData[choicesKey].__classes = {};
          if (!importedData[choicesKey].__classes[band]) importedData[choicesKey].__classes[band] = {};
          if (!importedData[LS_KEYS.studentClassUploadInfo]) importedData[LS_KEYS.studentClassUploadInfo] = {};
          rows.forEach(row => {
            if (row[0]) {
              const student = row[0].trim();
              const choices = choiceIdxs
                .map(index => String(row[index] || '').trim())
                .filter(Boolean);
              if (choices.length > 0) {
                importedData[choicesKey][band][student] = choices;
              }
              const className = classIdx >= 0 ? String(row[classIdx] || '').trim() : '';
              if (className) {
                importedData[choicesKey].__classes[band][student] = className;
                rememberClassOnUpload(
                  importedData[LS_KEYS.studentClassUploadInfo],
                  student,
                  slotKey,
                  band,
                  className
                );
              }
            }
          });
        }
      } else {
        // Map filename to data key
        const keyMap = {
          'students.csv': 'wv_students',
          'workshops.csv': 'wv_workshops',
          'previous-assignments.csv': 'wv_prevAssignments',
          'prerequisites.csv': 'wv_prereqs',
          'cannot-be-parallel.csv': 'wv_cannotBeParallel',
          'rules.csv': 'wv_rules',
          'student-trimesters.csv': 'wv_studentTrimesters',
          'student-assistants.csv': 'wv_studentAssistants',
          'student-classes.csv': 'wv_studentClasses',
          'student-enrollment-years.csv': 'wv_studentEnrollmentYears',
          'priority-scores.csv': 'wv_studentPriorityScores',
          'priority-scores-last-changed.csv': 'wv_studentPriorityScoresLastChanged',
          'workshop-colors.csv': 'wv_workshopColors',
          'student-comments.csv': 'wv_studentComments',
          'manual-rule-checks.csv': 'wv_manualRuleChecks',
          'workshop-teachers.csv': 'wv_workshopTeachers',
          'workshop-rooms.csv': 'wv_workshopRooms',
          'archived-workshops.csv': 'wv_archivedWorkshops'
        };
        
        const dataKey = keyMap[filename];
        if (dataKey) {
          importedData[dataKey] = parseCSVToData(dataKey, data);
        }
      }
    }
    
    return importedData;
  } catch (error) {
    console.error('Failed to import ZIP:', error);
    throw error;
  }
}


function hasPrereqs(student, workshopName, prevAssignments, prereqs) {
    const required = prereqs[workshopName] || [];
    if (required.length === 0) return true;

    const prevWorkshops = prevAssignments[student] || []; // array of past workshops
    return required.every(req => prevWorkshops.includes(req));
}

function workshopsFromHistoryEntry(entry) {
  const found = [];
  const push = (workshop) => {
    if (workshop && !isNotAssigned(workshop)) found.push(workshop);
  };
  if (Array.isArray(entry?.bandAssignments)) {
    entry.bandAssignments.forEach(push);
  } else if (entry?.bandAssignments && typeof entry.bandAssignments === 'object') {
    Object.values(entry.bandAssignments).forEach(push);
  }
  push(entry?.erstesBand);
  push(entry?.zweitesBand);
  if (found.length === 0 && entry?.assigned && !String(entry.assigned).includes('/')) {
    push(entry.assigned);
  }
  return found;
}

function bandIdForCourse(entry, course) {
  if (Array.isArray(entry?.bandIds) && Array.isArray(entry?.bandAssignments)) {
    const index = entry.bandAssignments.findIndex(workshop => workshop === course);
    return index >= 0 ? entry.bandIds[index] : null;
  }
  if (entry?.bandAssignments && typeof entry.bandAssignments === 'object') {
    return Object.keys(entry.bandAssignments).find(bandId => entry.bandAssignments[bandId] === course) || null;
  }
  if (entry?.erstesBand === course) return 'erstesBand';
  if (entry?.zweitesBand === course) return 'zweitesBand';
  return null;
}

function flattenWorkshopsFromStudentHistory(historyEntries) {
  return (historyEntries || []).flatMap(workshopsFromHistoryEntry);
}

function countDistinctWorkshopsFromOptions(historyFlat, options) {
  const allowed = new Set(options || []);
  const matched = new Set();
  historyFlat.forEach(w => {
    if (allowed.has(w)) matched.add(w);
  });
  return matched.size;
}

function ruleToExportRow(item) {
  const ruleType = item.type || 'belegung';
  return [
    ruleType,
    item.name || '',
    (item.options || []).join(', '),
    item.fromCourse || '',
    item.toCourse || '',
    item.sameBand ? 'true' : 'false',
    item.duration != null ? String(item.duration) : '',
    item.minCount != null ? String(item.minCount) : '',
    item.description || '',
    (() => {
      const range = getRuleKlassenStufenRange(item);
      return range ? `${range.from}-${range.to}` : '';
    })(),
    item.einschulungsjahrFrom != null ? String(item.einschulungsjahrFrom) : '',
    item.einschulungsjahrTo != null ? String(item.einschulungsjahrTo) : '',
  ];
}

function getRuleTypeLabel(ruleType) {
  switch (ruleType) {
    case 'folgekurs': return 'Folgekurs';
    case 'mindestbelegung': return 'Mindestanzahl';
    case 'freitext': return 'Freitext / Checkliste';
    case 'belegung':
    default: return 'Alle Kurse';
  }
}

function parseKlassenStufeFromClass(className) {
  if (!className) return null;
  const match = String(className).trim().match(/^(\d{1,2})/);
  if (!match) return null;
  const stufe = parseInt(match[1], 10);
  return Number.isFinite(stufe) ? stufe : null;
}

/** Erster Werkstatt-Jahrgang (Stufe 5 → Einschulungsjahr = Schuljahresstart). */
const DEFAULT_EINSCHULUNG_ENTRY_STUFE = 5;

/**
 * Leitet das Einschulungsjahr aus dem Schuljahresstart und der Klassenstufe beim ersten Wahl-Upload ab.
 * Beispiel: Stufe 5 in SJ 2024/25 → 2024; Stufe 7 in SJ 2025/26 → 2023.
 */
function inferEinschulungsjahrFromWahlClass(schoolYearStart, className, entryStufe = DEFAULT_EINSCHULUNG_ENTRY_STUFE) {
  const stufe = parseKlassenStufeFromClass(className);
  if (stufe == null || !Number.isFinite(Number(schoolYearStart))) return null;
  const yearsSinceEntry = stufe - entryStufe;
  if (yearsSinceEntry < 0) return null;
  return Number(schoolYearStart) - yearsSinceEntry;
}

function normalizeRuleKlassenStufen(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(list.map(v => parseInt(String(v).trim(), 10)).filter(n => Number.isFinite(n)))].sort((a, b) => a - b);
}

function getStudentKlassenStufe(student, studentClasses) {
  return parseKlassenStufeFromClass(studentClasses?.[student]);
}

function parseOptionalRuleYear(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function getStudentEinschulungsjahr(student, studentEnrollmentYears) {
  return parseOptionalRuleYear(studentEnrollmentYears?.[student]);
}

function getEinschulungsjahrYearOptions() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = 2020; y <= current + 2; y++) years.push(y);
  return years;
}

function getRuleEinschulungsjahrgangBounds(rule) {
  const from = parseOptionalRuleYear(rule?.einschulungsjahrFrom);
  const to = parseOptionalRuleYear(rule?.einschulungsjahrTo);
  return { from, to };
}

/** open = no filter | match | missing | outside */
function getStudentCohortRuleStatus(rule, student, studentEnrollmentYears) {
  const { from, to } = getRuleEinschulungsjahrgangBounds(rule);
  if (from == null && to == null) return 'open';
  const year = getStudentEinschulungsjahr(student, studentEnrollmentYears);
  if (year == null) return 'missing';
  if (from != null && year < from) return 'outside';
  if (to != null && year > to) return 'outside';
  return 'match';
}

function getRuleKlassenStufenRange(rule) {
  if (rule?.klassenStufenRange?.from != null && rule?.klassenStufenRange?.to != null) {
    let from = Number(rule.klassenStufenRange.from);
    let to = Number(rule.klassenStufenRange.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }
  const list = normalizeRuleKlassenStufen(rule?.klassenStufen);
  if (list.length === 0) return null;
  return { from: list[0], to: list[list.length - 1] };
}

/** upcoming | active | after | unknown | all */
function getRuleZeitraumPhase(rule, student, studentClasses) {
  const range = getRuleKlassenStufenRange(rule);
  if (!range) return 'all';
  const stufe = getStudentKlassenStufe(student, studentClasses);
  if (stufe == null) return 'unknown';
  if (stufe < range.from) return 'upcoming';
  if (stufe > range.to) return 'after';
  return 'active';
}

function ruleAppliesToStudent(rule, student, studentClasses, studentEnrollmentYears = {}) {
  const cohort = getStudentCohortRuleStatus(rule, student, studentEnrollmentYears);
  if (cohort === 'missing' || cohort === 'outside') return false;
  const phase = getRuleZeitraumPhase(rule, student, studentClasses);
  if (phase === 'upcoming' || phase === 'unknown') return false;
  return true;
}

function ruleEnforcesNow(rule, student, studentClasses, studentEnrollmentYears = {}) {
  const cohort = getStudentCohortRuleStatus(rule, student, studentEnrollmentYears);
  if (cohort !== 'open' && cohort !== 'match') return false;
  return getRuleZeitraumPhase(rule, student, studentClasses) === 'active';
}

function formatRuleScopeLabel(rule) {
  const parts = [];
  const range = getRuleKlassenStufenRange(rule);
  if (range) parts.push(`Stufe ${range.from}–${range.to}`);
  else parts.push('alle Stufen');
  const { from, to } = getRuleEinschulungsjahrgangBounds(rule);
  if (from == null && to == null) parts.push('alle Einschulungsjahrgänge');
  else if (from != null && to != null) parts.push(`Einschulung ${from}–${to}`);
  else if (from != null) parts.push(`Einschulung ab ${from}`);
  else parts.push(`Einschulung bis ${to}`);
  return parts.join(' · ');
}

function formatRuleZeitraumLabel(rule) {
  return formatRuleScopeLabel(rule);
}

function mergeKlassenStufenPool(savedPool, classRegistry) {
  const fromClasses = (classRegistry || [])
    .map(parseKlassenStufeFromClass)
    .filter(stufe => stufe != null);
  const base = normalizeRuleKlassenStufen(savedPool);
  const fallback = base.length > 0 ? base : [5, 6, 7, 8, 9, 10];
  return [...new Set([...fallback, ...fromClasses])].sort((a, b) => a - b);
}

function parseKlassenStufenRangeFromCsvCell(cell) {
  if (!cell) return null;
  const raw = String(cell).trim();
  const rangeMatch = raw.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (rangeMatch) {
    const from = parseInt(rangeMatch[1], 10);
    const to = parseInt(rangeMatch[2], 10);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
  const list = normalizeRuleKlassenStufen(raw);
  if (list.length === 0) return null;
  return { from: list[0], to: list[list.length - 1] };
}

// Check if student needs to follow a Folgekurs rule
function getRequiredFolgekurs(student, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band, studentClasses = {}, studentEnrollmentYears = {}) {
  const folgekursRules = rules.filter(
    r => (r.type || 'belegung') === 'folgekurs' && ruleEnforcesNow(r, student, studentClasses, studentEnrollmentYears)
  );
  if (folgekursRules.length === 0) return null;
  
  const prevKey = getPreviousTrimesterKey(schoolYearStart, schoolYearEnd, currentTrimester);
  const prevAssignment = confirmedAssignments[prevKey];
  
  if (!prevAssignment || !prevAssignment.assignments) return null;
  
  const prevBandIds = getPayloadBandIds(prevAssignment);
  let prevCourseByBand = {};
  
  if (isLegacySingleBandAssignments(prevAssignment.assignments)) {
    const legacyCourse = prevAssignment.assignments[student];
    if (legacyCourse && !isNotAssigned(legacyCourse)) {
      prevCourseByBand[ALL_BAND_IDS[0]] = legacyCourse;
    }
  } else {
    prevBandIds.forEach(bandId => {
      const course = prevAssignment.assignments[bandId]?.[student];
      if (course && !isNotAssigned(course)) {
        prevCourseByBand[bandId] = course;
      }
    });
  }
  
  for (const rule of folgekursRules) {
    let prevBand = null;
    for (const bandId of prevBandIds) {
      if (prevCourseByBand[bandId] === rule.fromCourse) {
        prevBand = bandId;
        break;
      }
    }
    
    if (prevBand) {
      if (rule.sameBand) {
        return { course: rule.toCourse, band: prevBand };
      }
      return { course: rule.toCourse, band: null };
    }
  }
  
  return null;
}

function isFolgekursFulfilled(requiredFolgekurs, assignments, student, activeBandIds) {
  if (!requiredFolgekurs) return true;
  if (requiredFolgekurs.band !== null) {
    return assignments[requiredFolgekurs.band]?.[student] === requiredFolgekurs.course;
  }
  return activeBandIds.some(
    bandId => assignments[bandId]?.[student] === requiredFolgekurs.course
  );
}

function buildPriorWorkshopsFromOtherBands(dragByBand, activeBandIds, excludeBandId, studentList) {
  const priorWorkshopsByStudent = {};
  studentList.forEach(student => {
    priorWorkshopsByStudent[student] = [];
  });
  activeBandIds.forEach(bandId => {
    if (bandId === excludeBandId) return;
    studentList.forEach(student => {
      const workshop = dragByBand[bandId]?.[student];
      if (!isNotAssigned(workshop) && !priorWorkshopsByStudent[student].includes(workshop)) {
        priorWorkshopsByStudent[student].push(workshop);
      }
    });
  });
  return priorWorkshopsByStudent;
}

function courseAllowsSelfParallel(workshopName, allowSelfParallel) {
  return allowSelfParallel?.[workshopName] === true;
}

function rememberClassOnUpload(map, student, trimesterKey, bandId, className) {
  if (!student || !className) return;
  const existing = map[student] || {};
  const uploads = Array.isArray(existing.uploads) ? existing.uploads.filter(
    entry => !(entry.trimesterKey === trimesterKey && entry.bandId === bandId)
  ) : [];
  uploads.push({ trimesterKey, bandId, className });
  const latest = [...uploads].sort((a, b) => String(a.trimesterKey).localeCompare(String(b.trimesterKey))).pop();
  map[student] = {
    trimesterKey: latest.trimesterKey,
    className: latest.className,
    uploads,
  };
}

function choiceColumnIndexes(header) {
  const normalized = (header || []).map(cell => String(cell || '').trim().toLowerCase());
  const classIdx = normalized.findIndex(cell => cell === 'klasse' || cell === 'class' || cell === 'klassen');
  let choiceIdxs = normalized
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => index !== 0 && index !== classIdx && (/^wahl/.test(cell) || /^wunsch/.test(cell) || /^q\d+$/.test(cell)))
    .map(({ index }) => index);
  if (!choiceIdxs.length) {
    choiceIdxs = normalized.map((_, index) => index).filter(index => index !== 0 && index !== classIdx);
  }
  return { classIdx, choiceIdxs };
}

function buildModifiedChoicesForBand(choicesMapFull, bandId, priorWorkshopsByStudent, cannotBeParallel, allowSelfParallel = {}) {
  const bandChoices = choicesMapFull[bandId] || {};
  const modifiedChoices = {};
  Object.keys(bandChoices).forEach(student => {
    if (student.startsWith('__')) return;
    const originalChoices = bandChoices[student] || [];
    if (!Array.isArray(originalChoices)) return;
    const priorWorkshops = priorWorkshopsByStudent[student] || [];
    let filteredChoices = originalChoices.filter(choice => {
      if (!priorWorkshops.includes(choice)) return true;
      return courseAllowsSelfParallel(choice, allowSelfParallel);
    });
    priorWorkshops.forEach(priorWorkshop => {
      const cannotList = cannotBeParallel[priorWorkshop] || [];
      filteredChoices = filteredChoices.filter(choice => !cannotList.includes(choice));
    });
    if (filteredChoices.length > 0) {
      modifiedChoices[student] = filteredChoices;
    }
  });
  Object.keys(bandChoices).forEach(student => {
    if (!(priorWorkshopsByStudent[student]?.length) && bandChoices[student] && !modifiedChoices[student]) {
      modifiedChoices[student] = bandChoices[student];
    }
  });
  return modifiedChoices;
}

function applyCrossBandConflictFixes(bandResult, bandId, priorWorkshopsByStudent, cannotBeParallel, workshops, allowSelfParallel = {}) {
  const conflicts = [];
  Object.keys(bandResult.assignments).forEach(student => {
    const currentWorkshop = bandResult.assignments[student];
    const priorWorkshops = priorWorkshopsByStudent[student] || [];
    if (!currentWorkshop) return;

    if (priorWorkshops.includes(currentWorkshop) && !courseAllowsSelfParallel(currentWorkshop, allowSelfParallel)) {
      delete bandResult.assignments[student];
      const capacity = getWorkshopCapacity(workshops[currentWorkshop], currentWorkshop);
      if (bandResult.kap) {
        bandResult.kap[currentWorkshop] = (bandResult.kap[currentWorkshop] || capacity) + 1;
      }
      if (bandResult.num1 > 0) bandResult.num1--;
      if (bandResult.num2 > 0) bandResult.num2--;
      conflicts.push(`${student} wurde in mehreren Bändern ${currentWorkshop} zugeordnet. Die Zuordnung in ${getBandLabel(bandId)} wurde entfernt - bitte manuell zuordnen.`);
      return;
    }

    priorWorkshops.forEach(priorWorkshop => {
      const priorCannot = cannotBeParallel[priorWorkshop] || [];
      const currentCannot = cannotBeParallel[currentWorkshop] || [];
      if (priorCannot.includes(currentWorkshop) || currentCannot.includes(priorWorkshop)) {
        if (bandResult.assignments[student] === currentWorkshop) {
          delete bandResult.assignments[student];
          const capacity = getWorkshopCapacity(workshops[currentWorkshop], currentWorkshop);
          if (bandResult.kap) {
            bandResult.kap[currentWorkshop] = (bandResult.kap[currentWorkshop] || capacity) + 1;
          }
          if (bandResult.num1 > 0) bandResult.num1--;
          if (bandResult.num2 > 0) bandResult.num2--;
          conflicts.push(`${student} wurde ${priorWorkshop} und ${currentWorkshop} parallel zugeordnet, aber diese können nicht parallel belegt werden. Die Zuordnung in ${getBandLabel(bandId)} wurde entfernt - bitte manuell zuordnen.`);
        }
      }
    });
  });
  return conflicts;
}

function recomputeAutoResultTotals(bandResults, problems, activeBandIds, students) {
  let totalFirst = 0;
  let totalSecond = 0;
  activeBandIds.forEach(bandId => {
    totalFirst += bandResults[bandId]?.num1 || 0;
    totalSecond += bandResults[bandId]?.num2 || 0;
  });
  const percentFirst = students.length > 0 && activeBandIds.length > 0
    ? (totalFirst / (students.length * activeBandIds.length)) * 100
    : 0;
  return {
    bandResults,
    problems,
    totalFirst,
    totalSecond,
    percentFirst,
    activeBandIds,
    erstesBand: bandResults[activeBandIds[0]] || { assignments: {}, problems: [], num1: 0, num2: 0 },
    zweitesBand: bandResults[activeBandIds[1]] || { assignments: {}, problems: [], num1: 0, num2: 0 },
  };
}

function sortStudentsByPriority(students, studentPriorityScores) {
  return [...students].sort((a, b) => {
    const scoreA = studentPriorityScores[a] || 5;
    const scoreB = studentPriorityScores[b] || 5;
    return scoreB - scoreA;
  });
}

function autoAssignOneBandWithPrior(
  students,
  workshops,
  prevAssignments,
  prereqs,
  choicesMapFull,
  studentAssistants,
  studentPriorityScores,
  rules,
  confirmedAssignments,
  schoolYearStart,
  schoolYearEnd,
  currentTrimester,
  cannotBeParallel,
  bandId,
  priorWorkshopsByStudent,
  studentClasses = {},
  studentEnrollmentYears = {},
  wahlCount = 2,
  allowSelfParallel = {}
) {
  const sortedStudents = sortStudentsByPriority(students, studentPriorityScores);
  const modifiedChoices = buildModifiedChoicesForBand(choicesMapFull, bandId, priorWorkshopsByStudent, cannotBeParallel, allowSelfParallel);
  const bandResult = autoAssignSingleBand(
    sortedStudents,
    workshops,
    prevAssignments,
    prereqs,
    modifiedChoices,
    studentAssistants,
    studentPriorityScores,
    rules,
    confirmedAssignments,
    schoolYearStart,
    schoolYearEnd,
    currentTrimester,
    bandId,
    studentClasses,
    studentEnrollmentYears,
    wahlCount
  );
  const conflictMessages = applyCrossBandConflictFixes(
    bandResult,
    bandId,
    priorWorkshopsByStudent,
    cannotBeParallel,
    workshops,
    allowSelfParallel
  );
  const problems = [
    ...bandResult.problems.map(p => ({ message: p, band: bandId, bandLabel: getBandLabel(bandId) })),
    ...conflictMessages.map(p => ({ message: p, band: 'all', bandLabel: 'Alle Bänder' })),
  ];
  return { bandResult, problems };
}

// Auto-assignment algorithm for all active bands
function autoAssignAllBands(students, workshops, prevAssignments, prereqs, choicesMap, studentAssistants = {}, studentPriorityScores = {}, rules = [], confirmedAssignments = {}, schoolYearStart, schoolYearEnd, currentTrimester, cannotBeParallel = {}, activeBandIds = DEFAULT_BAND_IDS, studentClasses = {}, studentEnrollmentYears = {}, wahlCount = 2, allowSelfParallel = {}) {
  const bandResults = {};
  const cumulativeByStudent = {};
  const allProblems = [];

  activeBandIds.forEach(bandId => {
    const priorWorkshopsByStudent = {};
    Object.keys(cumulativeByStudent).forEach(student => {
      priorWorkshopsByStudent[student] = [...(cumulativeByStudent[student] || [])];
    });

    const { bandResult, problems } = autoAssignOneBandWithPrior(
      students,
      workshops,
      prevAssignments,
      prereqs,
      choicesMap,
      studentAssistants,
      studentPriorityScores,
      rules,
      confirmedAssignments,
      schoolYearStart,
      schoolYearEnd,
      currentTrimester,
      cannotBeParallel,
      bandId,
      priorWorkshopsByStudent,
      studentClasses,
      studentEnrollmentYears,
      wahlCount,
      allowSelfParallel
    );

    bandResults[bandId] = bandResult;
    allProblems.push(...problems);

    Object.keys(bandResult.assignments).forEach(student => {
      const workshop = bandResult.assignments[student];
      if (workshop) {
        if (!cumulativeByStudent[student]) cumulativeByStudent[student] = [];
        cumulativeByStudent[student].push(workshop);
      }
    });
  });

  return recomputeAutoResultTotals(bandResults, allProblems, activeBandIds, students);
}

// Legacy alias kept for external references
// eslint-disable-next-line no-unused-vars
function autoAssignBothBands(students, workshops, prevAssignments, prereqs, choicesMap, studentAssistants, studentPriorityScores, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, cannotBeParallel) {
  return autoAssignAllBands(students, workshops, prevAssignments, prereqs, choicesMap, studentAssistants, studentPriorityScores, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, cannotBeParallel, DEFAULT_BAND_IDS);
}

// Single Band auto-assignment algorithm
function autoAssignSingleBand(students, workshops, prevAssignments, prereqs, choicesMap, studentAssistants = {}, studentPriorityScores = {}, rules = [], confirmedAssignments = {}, schoolYearStart, schoolYearEnd, currentTrimester, band, studentClasses = {}, studentEnrollmentYears = {}, wahlCount = 2) {
  const maxWahl = Math.min(Math.max(1, wahlCount || 2), 5);
  // choicesMap: { studentName: [choice1, choice2, ...] }
  // Filter workshops to only those available in this band
  const availableWorkshops = {};
  const kap = {};
  Object.keys(workshops).forEach(workshopName => {
    if (isWorkshopAvailableInBand(workshops, workshopName, band)) {
      availableWorkshops[workshopName] = workshops[workshopName];
      kap[workshopName] = getWorkshopCapacity(workshops[workshopName], workshopName);
    }
  });
  
  const assignments = {};
  const problems = [];
  let num1 = 0;
  let num2 = 0;

  // Track special assistance students per workshop
  const specialAssistancePerWorkshop = {};
  Object.keys(availableWorkshops).forEach(workshop => {
    specialAssistancePerWorkshop[workshop] = 0;
  });
  
  // Filter choices to only include workshops available in this band
  const filteredChoicesMap = {};
  Object.keys(choicesMap).forEach(student => {
    const choices = (choicesMap[student] || [])
      .slice(0, maxWahl)
      .filter(choice => isWorkshopAvailableInBand(workshops, choice, band));
    if (choices.length > 0) {
      filteredChoicesMap[student] = choices;
    } else if (choicesMap[student] && choicesMap[student].length > 0) {
      // Student has choices but none are available in this band
      problems.push(`${student} hat nur Werkstätten gewählt, die in ${getBandLabel(band)} nicht verfügbar sind.`);
    }
  });

  // Use filtered choices map
  const workingChoicesMap = filteredChoicesMap;

  // sanitize: if all listed choices are identical -> reduce to single
  for (const s of students) {
    const choices = workingChoicesMap[s] || [];
    if (choices.length > 1 && choices.every(c => c === choices[0])) {
      problems.push(`${s} hat ${choices.length}× dieselbe Werkstatt ${choices[0]} gewählt.`);
      workingChoicesMap[s] = [choices[0]];
    }
  }

  // remove previous year's workshop from choices
  for (const s of students) {
    const ch = workingChoicesMap[s] || [];
    if (s in prevAssignments) {
      const last = prevAssignments[s];
      const idx = ch.indexOf(last);
      if (idx !== -1) {
        ch.splice(idx, 1);
        problems.push(`${s} hatte bereits ${last} im letzten Jahr, daher entfernt aus den Wahlen.`);
      }
    }
    workingChoicesMap[s] = ch;
  }

  // Separate students by priority: those needing assistance (always first), then by priority score
  // Also prioritize students who need to follow Folgekurs rules
  const studentsNeedingAssistance = students.filter(s => studentAssistants[s]);
  const regularStudents = students.filter(s => !studentAssistants[s]);
  
  // Check which students need to follow Folgekurs rules
  const studentsWithFolgekurs = new Set();
  students.forEach(s => {
    const required = getRequiredFolgekurs(s, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band, studentClasses, studentEnrollmentYears);
    if (required) {
      studentsWithFolgekurs.add(s);
    }
  });
  
  // Sort both groups by priority: Folgekurs first, then by priority score (higher score = higher priority)
  const sortByPriority = (a, b) => {
    const hasFolgekursA = studentsWithFolgekurs.has(a);
    const hasFolgekursB = studentsWithFolgekurs.has(b);
    
    // Students with Folgekurs rules come first
    if (hasFolgekursA && !hasFolgekursB) return -1;
    if (!hasFolgekursA && hasFolgekursB) return 1;
    
    // Then sort by priority score
    const scoreA = studentPriorityScores[a] || 5;
    const scoreB = studentPriorityScores[b] || 5;
    return scoreB - scoreA; // Higher score first
  };
  
  studentsNeedingAssistance.sort(sortByPriority);
  regularStudents.sort(sortByPriority);

  // Helper function to assign a student to a workshop
  function assignStudent(student, workshop, isFirstChoice) {
    if ((kap[workshop] ?? 0) > 0) {
      assignments[student] = workshop;
      kap[workshop] -= 1;
      if (studentAssistants[student]) {
        specialAssistancePerWorkshop[workshop] += 1;
      }
      if (isFirstChoice) {
        num1 += 1;
      } else {
        num2 += 1;
      }
      return true;
    }
    return false;
  }

  // Helper function to find the workshop with the least special assistance students
  function findWorkshopWithLeastSpecialAssistance(choices) {
    let bestWorkshop = choices[0];
    let minSpecialAssistance = specialAssistancePerWorkshop[choices[0]] || 0;
    
    for (const choice of choices) {
      const currentSpecialAssistance = specialAssistancePerWorkshop[choice] || 0;
      if (currentSpecialAssistance < minSpecialAssistance) {
        minSpecialAssistance = currentSpecialAssistance;
        bestWorkshop = choice;
      }
    }
    
    return bestWorkshop;
  }

  // First pass: Assign students needing special assistance (prioritize even distribution)
  // Also prioritize students with Folgekurs rules
  for (const s of studentsNeedingAssistance) {
    // Check if student needs to follow a Folgekurs rule
    const requiredFolgekurs = getRequiredFolgekurs(s, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band, studentClasses, studentEnrollmentYears);
    if (requiredFolgekurs) {
      // Student must be assigned to the Folgekurs
      if (requiredFolgekurs.band === null || requiredFolgekurs.band === band) {
        if (assignStudent(s, requiredFolgekurs.course, true)) {
          continue;
        } else {
          problems.push(`${s} muss ${requiredFolgekurs.course} belegen (Folgekurs-Regel), aber Kapazität ist erreicht.`);
        }
      }
    }
    
    const ch = workingChoicesMap[s] || [];
    if (ch.length > 0) {
      const first = ch[0];
      if (!hasPrereqs(s, first, prevAssignments, prereqs)) {
        problems.push(`${s} erfüllt die Voraussetzungen für ${first} nicht.`);
        continue;
      }
      
      // Try to assign to the workshop with least special assistance students
      const bestWorkshop = findWorkshopWithLeastSpecialAssistance(ch);
      if (assignStudent(s, bestWorkshop, true)) {
        continue;
      }
      
      // If that doesn't work, try any available choice
      for (const choice of ch) {
        if (hasPrereqs(s, choice, prevAssignments, prereqs) && assignStudent(s, choice, true)) {
          break;
        }
      }
    } else {
      problems.push(`${s} hat keine gültigen Wahlen.`);
    }
  }

  // Second pass: Assign regular students
  for (const s of regularStudents) {
    // Check if student needs to follow a Folgekurs rule
    const requiredFolgekurs = getRequiredFolgekurs(s, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band, studentClasses, studentEnrollmentYears);
    if (requiredFolgekurs) {
      // Student must be assigned to the Folgekurs
      if (requiredFolgekurs.band === null || requiredFolgekurs.band === band) {
        if (assignStudent(s, requiredFolgekurs.course, true)) {
          continue;
        } else {
          problems.push(`${s} muss ${requiredFolgekurs.course} belegen (Folgekurs-Regel), aber Kapazität ist erreicht.`);
        }
      }
    }
    
    const ch = workingChoicesMap[s] || [];
    if (ch.length > 0) {
      const first = ch[0];
      if (!hasPrereqs(s, first, prevAssignments, prereqs)) {
        problems.push(`${s} erfüllt die Voraussetzungen für ${first} nicht.`);
        continue;
      }
      if ((kap[first] ?? 0) > 0) {
        assignments[s] = first;
        kap[first] -= 1;
        num1 += 1;
      }
    } else {
      problems.push(`${s} hat keine gültigen Wahlen.`);
    }
  }

  // Further passes: 2nd, 3rd, … choice for students still unassigned
  for (let rank = 1; rank < maxWahl; rank++) {
    for (const s of students) {
      if (s in assignments) continue;
      const ch = workingChoicesMap[s] || [];
      if (ch.length > rank) {
        const choice = ch[rank];
        if (!hasPrereqs(s, choice, prevAssignments, prereqs)) {
          problems.push(`${s} erfüllt die Voraussetzungen für ${choice} (${rank + 1}. Wahl) nicht.`);
          continue;
        }
        if ((kap[choice] ?? 0) > 0) {
          assignments[s] = choice;
          kap[choice] -= 1;
          num2 += 1;
        }
      } else if (ch.length === rank) {
        problems.push(
          rank === 1
            ? `${s} hat seine erste Wahl nicht bekommen und hat keine gültige zweite Wahl.`
            : `${s} hat keine gültige ${rank + 1}. Wahl (höhere Wahlen nicht vergeben).`
        );
      }
    }
  }

  const percentFirst = (num1 / students.length) * 100;

  return { assignments, problems, kap, num1, num2, percentFirst };
}

// (isNotAssigned defined above with band helpers)

// ----------------------------
// Main component
// ----------------------------
export default function WerkstattVerwaltungApp() {
    const [tab, setTab] = useState("students");

    // Load or initialize data
    const [students, setStudents] = useState(() => load(LS_KEYS.students, []));
    const [workshops, setWorkshops] = useState(() => {
      const loaded = load(LS_KEYS.workshops, {});
      return normalizeWorkshopData(loaded);
    });
    const [prevAssignments, setPrevAssignments] = useState(() => load(LS_KEYS.prevAssignments, {}));
    const [prereqs, setPrereqs] = useState(() => load(LS_KEYS.prereqs, {}));
    const [cannotBeParallel, setCannotBeParallel] = useState(() => load(LS_KEYS.cannotBeParallel, {}));
    const [allowSelfParallel, setAllowSelfParallel] = useState(() => load(LS_KEYS.allowSelfParallel, {}));
    const [confirmedAssignments, setConfirmedAssignments] = useState(() => load(LS_KEYS.assignments, {}));
    const [rules, setRules] = useState(() => load(LS_KEYS.rules, []));
    const [studentTrimesters, setStudentTrimesters] = useState(() => load(LS_KEYS.studentTrimesters, {}));
    const [studentAssistants, setStudentAssistants] = useState(() => load(LS_KEYS.studentAssistants, {})); // NEW
  const [studentClasses, setStudentClasses] = useState(() => load(LS_KEYS.studentClasses, {})); // NEW: store class information for each student
  const [classRegistry, setClassRegistry] = useState(() => {
    const saved = load(LS_KEYS.classRegistry, null);
    const fromStudents = Object.values(load(LS_KEYS.studentClasses, {})).filter(Boolean);
    const base = Array.isArray(saved) ? saved : [];
    return [...new Set([...base, ...fromStudents])].sort();
  });
  const [klassenStufenPool, setKlassenStufenPool] = useState(() => {
    const saved = load(LS_KEYS.klassenStufenPool, null);
    const registry = load(LS_KEYS.classRegistry, []);
    return mergeKlassenStufenPool(saved, registry);
  });
  const [studentEnrollmentYears, setStudentEnrollmentYears] = useState(() => load(LS_KEYS.studentEnrollmentYears, {}));
  const [studentClassUploadInfo, setStudentClassUploadInfo] = useState(() => load(LS_KEYS.studentClassUploadInfo, {}));
  const [studentPriorityScores, setStudentPriorityScores] = useState(() => load(LS_KEYS.studentPriorityScores, {})); // NEW: map student -> priority score (1-10)
  const [studentPriorityScoresLastChanged, setStudentPriorityScoresLastChanged] = useState(() => load(LS_KEYS.studentPriorityScoresLastChanged, {})); // NEW: map student -> ISO timestamp of last manual change
  const [workshopColors, setWorkshopColors] = useState(() => load(LS_KEYS.workshopColors, {})); // NEW: map workshop -> color hex
  const [studentComments, setStudentComments] = useState(() => load(LS_KEYS.studentComments, {}));
  const loadChoicesForTrimesterKey = useCallback((planKey) => {
    if (!planKey) return createEmptyChoicesMap();
    return normalizeBandDataObject(load(`wv_choices_${planKey}`, createEmptyChoicesMap()));
  }, []);
  const [manualRuleChecks, setManualRuleChecks] = useState(() => load(LS_KEYS.manualRuleChecks, {})); // NEW: map student -> comment/notes
  const [workshopTeachers, setWorkshopTeachers] = useState(() => {
    const loaded = load(LS_KEYS.workshopTeachers, {});
    console.log('🔵 Initializing workshopTeachers state:', loaded);
    console.log('🔵 workshopTeachers keys:', Object.keys(loaded));
    return loaded;
  }); // NEW: map workshop -> teacher name
  const [workshopRooms, setWorkshopRooms] = useState(() => {
    const loaded = load(LS_KEYS.workshopRooms, {});
    console.log('🔵 Initializing workshopRooms state:', loaded);
    console.log('🔵 workshopRooms keys:', Object.keys(loaded));
    return loaded;
  }); // NEW: map workshop -> room number
  const [archivedWorkshops, setArchivedWorkshops] = useState(() => load(LS_KEYS.archivedWorkshops, {})); // NEW: map workshop -> { capacity, archivedAt }
  const [trimesterPlans, setTrimesterPlans] = useState(() => {
    const saved = normalizeTrimesterPlans(load(LS_KEYS.trimesterPlans, {}));
    const assignments = load(LS_KEYS.assignments, {});
    const registry = load(LS_KEYS.classRegistry, []);
    const pool = mergeKlassenStufenPool(load(LS_KEYS.klassenStufenPool, null), registry);
    const workshopsLoaded = load(LS_KEYS.workshops, {});
    return buildInferredTrimesterPlans({
      confirmedAssignments: assignments,
      choicesBySlotKey: collectChoicesBySlotKeyFromStorage(),
      klassenStufenPool: pool,
      workshopNames: Object.keys(workshopsLoaded),
      existingPlans: saved,
    });
  });
  const [selectedTrimesterPlanKey, setSelectedTrimesterPlanKey] = useState(null);
  const [isInitialMount, setIsInitialMount] = useState(true);
  const defaultSchoolYear = getDefaultSchoolYear();
  const [reportYearTrimester, setReportYearTrimester] = useState({ 
    schoolYearStart: defaultSchoolYear.schoolYearStart, 
    schoolYearEnd: defaultSchoolYear.schoolYearEnd, 
    trimester: 1 
  }); // NEW: for report generation

    // Persist state
    useEffect(() => save(LS_KEYS.students, students), [students]);
    useEffect(() => save(LS_KEYS.workshops, workshops), [workshops]);
    useEffect(() => save(LS_KEYS.prevAssignments, prevAssignments), [prevAssignments]);
    useEffect(() => save(LS_KEYS.prereqs, prereqs), [prereqs]);
    useEffect(() => save(LS_KEYS.cannotBeParallel, cannotBeParallel), [cannotBeParallel]);
    useEffect(() => save(LS_KEYS.allowSelfParallel, allowSelfParallel), [allowSelfParallel]);
    useEffect(() => save(LS_KEYS.assignments, confirmedAssignments), [confirmedAssignments]);
    useEffect(() => save(LS_KEYS.rules, rules), [rules]);
    useEffect(() => save(LS_KEYS.studentTrimesters, studentTrimesters), [studentTrimesters]);
    useEffect(() => save(LS_KEYS.studentAssistants, studentAssistants), [studentAssistants]); // persist assistants
  useEffect(() => save(LS_KEYS.studentClasses, studentClasses), [studentClasses]); // persist student classes
  useEffect(() => save(LS_KEYS.studentEnrollmentYears, studentEnrollmentYears), [studentEnrollmentYears]);
  useEffect(() => save(LS_KEYS.classRegistry, classRegistry), [classRegistry]);
  useEffect(() => save(LS_KEYS.klassenStufenPool, klassenStufenPool), [klassenStufenPool]);
  useEffect(() => {
    setKlassenStufenPool(prev => mergeKlassenStufenPool(prev, classRegistry));
  }, [classRegistry]);
  useEffect(() => save(LS_KEYS.studentClassUploadInfo, studentClassUploadInfo), [studentClassUploadInfo]);

  useEffect(() => {
    const fromStudents = Object.values(studentClasses).filter(Boolean);
    if (fromStudents.length === 0) return;
    setClassRegistry(prev => {
      const merged = [...new Set([...prev, ...fromStudents])].sort();
      if (merged.length === prev.length && merged.every((v, i) => v === prev[i])) return prev;
      return merged;
    });
  }, [studentClasses]);
  useEffect(() => save(LS_KEYS.studentPriorityScores, studentPriorityScores), [studentPriorityScores]); // persist priority scores
  useEffect(() => save(LS_KEYS.studentPriorityScoresLastChanged, studentPriorityScoresLastChanged), [studentPriorityScoresLastChanged]); // persist last changed timestamps
  useEffect(() => save(LS_KEYS.workshopColors, workshopColors), [workshopColors]); // persist workshop colors
  useEffect(() => save(LS_KEYS.studentComments, studentComments), [studentComments]); // persist student comments
  useEffect(() => save(LS_KEYS.manualRuleChecks, manualRuleChecks), [manualRuleChecks]); // persist manual rule checks
  // Skip saving on initial mount to avoid overwriting loaded data
  useEffect(() => {
    if (isInitialMount) {
      setIsInitialMount(false);
      console.log('⏭️ Skipping save on initial mount for workshopTeachers');
      return;
    }
    console.log('💾 useEffect: Saving workshopTeachers to localStorage:', workshopTeachers);
    console.log('💾 useEffect: Using key:', LS_KEYS.workshopTeachers);
    save(LS_KEYS.workshopTeachers, workshopTeachers);
  }, [workshopTeachers, isInitialMount]); // persist workshop teachers
  useEffect(() => {
    if (isInitialMount) {
      console.log('⏭️ Skipping save on initial mount for workshopRooms');
      return;
    }
    console.log('💾 useEffect: Saving workshopRooms to localStorage:', workshopRooms);
    console.log('💾 useEffect: Using key:', LS_KEYS.workshopRooms);
    save(LS_KEYS.workshopRooms, workshopRooms);
  }, [workshopRooms, isInitialMount]); // persist workshop rooms
  useEffect(() => save(LS_KEYS.archivedWorkshops, archivedWorkshops), [archivedWorkshops]);
  useEffect(() => save(LS_KEYS.trimesterPlans, trimesterPlans), [trimesterPlans]); // persist archived workshops

    // Students tab state
    const [query, setQuery] = useState("");
    const [classFilter, setClassFilter] = useState("");
    const [selectedStudents, setSelectedStudents] = useState(new Set());
    const [newStudentName, setNewStudentName] = useState("");
    const [newStudentClass, setNewStudentClass] = useState("");
    const filteredStudents = useMemo(() => {
      let filtered = students.filter(s => s.toLowerCase().includes(query.toLowerCase()));
      if (classFilter) {
        filtered = filtered.filter(s => studentClasses[s] === classFilter);
      }
      return filtered;
    }, [students, query, classFilter, studentClasses]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [showAddClassForm, setShowAddClassForm] = useState(false);
    const [showEinschulungsjahrInfo, setShowEinschulungsjahrInfo] = useState(false);
    const [newRegistryClassName, setNewRegistryClassName] = useState('');

    useEffect(() => {
      setShowAddClassForm(false);
      setShowEinschulungsjahrInfo(false);
      setNewRegistryClassName('');
    }, [selectedStudent]);

    const uniqueClasses = useMemo(() => classRegistry, [classRegistry]);

  // Wahl tab state
  const [uploadedChoices, setUploadedChoices] = useState(() => createEmptyChoicesMap());
  const [autoResult, setAutoResult] = useState(null);
  const [dragAssignments, setDragAssignments] = useState(() => createEmptyBandMap());
  const [activeBandCount, setActiveBandCount] = useState(DEFAULT_BAND_COUNT);
  const activeBandIds = useMemo(() => getBandIds(activeBandCount), [activeBandCount]);
  const [yearTrimester, setYearTrimester] = useState(() => {
    const defaultSchoolYear = getDefaultSchoolYear();
    return { 
      schoolYearStart: defaultSchoolYear.schoolYearStart, 
      schoolYearEnd: defaultSchoolYear.schoolYearEnd, 
      trimester: 1 
    };
  });
  const wahlTrimesterKey = useMemo(
    () => getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester),
    [yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester]
  );

  useEffect(() => {
    const additions = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index);
      if (!storageKey || !storageKey.startsWith('wv_choices_')) continue;
      let data;
      try {
        data = JSON.parse(localStorage.getItem(storageKey) || 'null');
      } catch {
        continue;
      }
      if (!data || typeof data !== 'object') continue;
      const slot = storageKey.slice('wv_choices_'.length);
      let dirty = false;
      if (!data.__classes || typeof data.__classes !== 'object') {
        data.__classes = {};
        dirty = true;
      }
      ALL_BAND_IDS.forEach(bandId => {
        const band = data[bandId];
        if (!band || typeof band !== 'object') return;
        if (!data.__classes[bandId]) {
          data.__classes[bandId] = {};
          dirty = true;
        }
        Object.entries(band).forEach(([student, choices]) => {
          if (!Array.isArray(choices) || !choices.length) return;
          if (!data.__classes[bandId][student] && studentClasses[student]) {
            data.__classes[bandId][student] = studentClasses[student];
            dirty = true;
          }
          const className = data.__classes[bandId][student];
          if (!className) return;
          additions.push({ student, trimesterKey: slot, bandId, className });
        });
      });
      if (dirty) {
        localStorage.setItem(storageKey, JSON.stringify(data));
        if (slot === wahlTrimesterKey) setUploadedChoices(data);
      }
    }
    if (!additions.length) return;
    setStudentClassUploadInfo(prev => {
      const next = { ...prev };
      let changed = false;
      additions.forEach(({ student, trimesterKey, bandId, className }) => {
        const before = JSON.stringify(next[student] || null);
        rememberClassOnUpload(next, student, trimesterKey, bandId, className);
        if (JSON.stringify(next[student]) !== before) changed = true;
      });
      return changed ? next : prev;
    });
  }, [studentClasses, wahlTrimesterKey]);
  const activeTrimesterPlan = useMemo(
    () => trimesterPlans[wahlTrimesterKey] || null,
    [trimesterPlans, wahlTrimesterKey]
  );
  const wahlTrimesterDefined = !!activeTrimesterPlan;
  const activeTrimesterWahlCount = useMemo(
    () => getTrimesterWahlCount(activeTrimesterPlan),
    [activeTrimesterPlan]
  );
  const definedTrimesterList = useMemo(() => plansAsSortedList(trimesterPlans), [trimesterPlans]);
  const [activeBand, setActiveBand] = useState('erstesBand'); // Track which Band is currently active
  const wahlVisibleWorkshops = useMemo(
    () =>
      Object.keys(workshops).filter(w => {
        if (!isWorkshopAvailableInBand(workshops, w, activeBand)) return false;
        if (activeTrimesterPlan?.courses[w]?.enabled === false) return false;
        if (activeTrimesterPlan && !isWorkshopOfferedInBand(activeTrimesterPlan, w, activeBand)) return false;
        return true;
      }),
    [workshops, activeBand, activeTrimesterPlan]
  );
  const getWahlWorkshopCapacity = useCallback(
    (name) => {
      if (activeTrimesterPlan) {
        return resolveTrimesterWorkshopMeta(activeTrimesterPlan, name, activeBand, {
          workshops,
          workshopTeachers,
          workshopRooms,
          workshopColors,
          getWorkshopCapacity,
        }).capacity;
      }
      return getWorkshopCapacity(workshops[name], name);
    },
    [activeTrimesterPlan, activeBand, workshops, workshopTeachers, workshopRooms, workshopColors]
  );
  const [checkedWarnings, setCheckedWarnings] = useState(() => {
    // Load checked warnings from localStorage
    const saved = localStorage.getItem('wv_checkedWarnings');
    return saved ? JSON.parse(saved) : {};
  }); // Track which warnings have been checked off
  const [showTrimesterDialog, setShowTrimesterDialog] = useState(false);
  const [showReportsTrimesterDialog, setShowReportsTrimesterDialog] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const dataMenuRef = React.useRef(null);
  const importDataInputRef = React.useRef(null);

  useEffect(() => {
    if (!dataMenuOpen) return;
    const onDocClick = (e) => {
      if (dataMenuRef.current && !dataMenuRef.current.contains(e.target)) {
        setDataMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [dataMenuOpen]);
  const [dialogYearTrimester, setDialogYearTrimester] = useState(() => {
    const defaultSchoolYear = getDefaultSchoolYear();
    return { 
      schoolYearStart: defaultSchoolYear.schoolYearStart, 
      schoolYearEnd: defaultSchoolYear.schoolYearEnd, 
      trimester: 1 
    };
  });
  const hasVisitedWahlTab = useRef(false);
  const currentTrimesterKeyRef = useRef(null);
  const isLoadingChoicesRef = useRef(false);

  const assignmentsForPriority = useMemo(() => {
    const merged = { ...confirmedAssignments };
    const key = getSchoolYearKey(
      yearTrimester.schoolYearStart,
      yearTrimester.schoolYearEnd,
      yearTrimester.trimester
    );
    if (tab === 'wahl' && hasAnyAssignmentInBands(dragAssignments, activeBandIds)) {
      merged[key] = {
        ...(merged[key] || {}),
        assignments: dragAssignments,
        timestamp: merged[key]?.timestamp || new Date().toISOString(),
        bands: activeBandIds,
      };
    }
    return merged;
  }, [confirmedAssignments, dragAssignments, yearTrimester, tab, activeBandIds]);

  const priorityScoresByStudent = useMemo(() => {
    const scores = {};
    students.forEach(student => {
      scores[student] = computePriorityScoreFromFullHistory(
        student,
        assignmentsForPriority,
        load,
        studentAssistants
      );
    });
    return scores;
  }, [students, assignmentsForPriority, studentAssistants, uploadedChoices]);

  useEffect(() => {
    setStudentPriorityScores(priorityScoresByStudent);
  }, [priorityScoresByStudent]);
  
  // Load assignments and choices when year/trimester changes or when first visiting wahl tab
  useEffect(() => {
    // Only load when entering wahl tab, not when leaving it
    if (tab !== 'wahl') return;
    
    // Mark that we've visited the wahl tab
    if (!hasVisitedWahlTab.current) {
      hasVisitedWahlTab.current = true;
    }
    
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    const planForKey = trimesterPlans[key];
    
    // Update the ref immediately to prevent auto-save from saving old data
    currentTrimesterKeyRef.current = key;
    
    const planBandIds = planForKey ? getPlanBandIds(planForKey) : null;
    // Load assignments for this year/trimester
    const savedAssignments = confirmedAssignments[key];
    if (savedAssignments && savedAssignments.assignments) {
      const savedBandIds = planBandIds?.length ? planBandIds : getPayloadBandIds(savedAssignments);
      setActiveBandCount(savedBandIds.length);

      if (hasAnyAssignmentInBands(savedAssignments.assignments, savedBandIds)) {
        setDragAssignments(normalizeBandDataObject(savedAssignments.assignments));
      } else {
        setDragAssignments(createStudentBandAssignments(students, savedBandIds));
      }
    } else {
      const bandIds = planBandIds?.length ? planBandIds : getBandIds(DEFAULT_BAND_COUNT);
      setActiveBandCount(bandIds.length);
      setDragAssignments(createStudentBandAssignments(students, bandIds));
    }
    if (planBandIds?.length && !planBandIds.includes(activeBand)) {
      setActiveBand(planBandIds[0]);
    }
    
    const choicesKey = `wv_choices_${key}`;
    isLoadingChoicesRef.current = true;
    const savedChoices = normalizeBandDataObject(load(choicesKey, createEmptyChoicesMap()));
    
    if (hasAnyChoicesInBands(savedChoices, ALL_BAND_IDS)) {
      setUploadedChoices(savedChoices);
    } else {
      setUploadedChoices(createEmptyChoicesMap());
    }
    // Reset the loading flag after a longer delay to ensure state has updated
    setTimeout(() => {
      isLoadingChoicesRef.current = false;
    }, 500);
    
    // Load autoResult for this year/trimester
    const autoResultKey = `wv_autoResult_${key}`;
    const savedAutoResult = load(autoResultKey, null);
    if (savedAutoResult) {
      setAutoResult(savedAutoResult);
    } else {
      setAutoResult(null);
    }
    
    // Reset all warnings and violations when switching trimester
    // Load checked warnings for this specific trimester (if they exist)
    const warningsKey = `wv_checkedWarnings_${key}`;
    const savedWarnings = load(warningsKey, {});
    if (Object.keys(savedWarnings).length > 0) {
      setCheckedWarnings(savedWarnings);
    } else {
      // If no warnings exist for this trimester, reset to empty
      setCheckedWarnings({});
    }
    
    // Reset violations (they are specific to current assignments)
    setPersistentViolations({});
    setDropViolations({});
    
    // Reset upload summary
    setUploadSummary(null);
  }, [yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, confirmedAssignments, students, tab, trimesterPlans]);

  useEffect(() => {
    if (tab !== 'wahl' || definedTrimesterList.length === 0) return;
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    if (!trimesterPlans[key]) {
      const p = definedTrimesterList[0];
      setYearTrimester({
        schoolYearStart: p.schoolYearStart,
        schoolYearEnd: p.schoolYearEnd,
        trimester: p.trimester,
      });
    }
  }, [tab, definedTrimesterList, trimesterPlans]);
  
  // Auto-save dragAssignments whenever they change (with debouncing to avoid too many saves)
  useEffect(() => {
    if (!hasVisitedWahlTab.current) return; // Don't save on initial mount
    if (tab !== 'wahl') return; // Only save when in wahl tab
    
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    
    // Update the ref to track current trimester
    currentTrimesterKeyRef.current = key;
    
    // Check if there are any actual assignments (not just undefined values)
    const hasActualAssignments = hasAnyAssignmentInBands(dragAssignments, activeBandIds);
    
    if (!hasActualAssignments) return;
    
    const timeoutId = setTimeout(() => {
      const currentKey = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
      if (currentKey !== currentTrimesterKeyRef.current) {
        return;
      }
      
      const payload = load(LS_KEYS.assignments, {});
      payload[key] = { 
        assignments: dragAssignments, 
        timestamp: new Date().toISOString(),
        bands: activeBandIds
      };
      save(LS_KEYS.assignments, payload);
      setConfirmedAssignments(payload);
      
      exportAssignment(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, dragAssignments, activeBandIds);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [dragAssignments, yearTrimester, tab, hasVisitedWahlTab, uploadedChoices, activeBandIds]);
  
  // Save assignments when leaving wahl tab (immediate save, no debounce)
  useEffect(() => {
    if (!hasVisitedWahlTab.current) return;
    if (tab === 'wahl') return; // Only save when leaving wahl tab
    
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    
    // Check if there are any actual assignments
    const hasAssignments = hasAnyAssignmentInBands(dragAssignments, activeBandIds);
    
    if (!hasAssignments) return;
    
    const payload = load(LS_KEYS.assignments, {});
    payload[key] = { 
      assignments: dragAssignments, 
      timestamp: new Date().toISOString(),
      bands: activeBandIds
    };
    save(LS_KEYS.assignments, payload);
    setConfirmedAssignments(payload);
    
    exportAssignment(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, dragAssignments, activeBandIds);
  }, [tab, dragAssignments, uploadedChoices, yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, activeBandIds]);
  
  // Save choices when they change (per year/trimester)
  useEffect(() => {
    if (!hasVisitedWahlTab.current) return; // Don't save on initial mount
    if (isLoadingChoicesRef.current) return; // Don't save while loading choices
    
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    const choicesKey = `wv_choices_${key}`;
    
    // Only save if there are actual choices
    if (hasAnyChoicesInBands(uploadedChoices, ALL_BAND_IDS)) {
      save(choicesKey, uploadedChoices, false);
    }
  }, [uploadedChoices, yearTrimester, hasVisitedWahlTab]);
  
  // Persist checked warnings per trimester
  useEffect(() => {
    if (!hasVisitedWahlTab.current) return; // Don't save on initial mount
    
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    const warningsKey = `wv_checkedWarnings_${key}`;
    save(warningsKey, checkedWarnings, false); // Don't auto-export warnings
  }, [checkedWarnings, yearTrimester, hasVisitedWahlTab]);


  // Calculate real-time statistics from drag assignments
  const currentStatistics = useMemo(() => {
    const stats = computeBandStatistics(dragAssignments, uploadedChoices, activeBandIds);
    return {
      percentFirst: stats.percentFirst,
      totalFirst: stats.totalFirst,
      totalSecond: stats.totalSecond,
      perBand: stats.perBand,
      erstesBand: stats.perBand[activeBandIds[0]] || { num1: 0, num2: 0, total: 0, percentFirst: 0 },
      zweitesBand: stats.perBand[activeBandIds[1]] || { num1: 0, num2: 0, total: 0, percentFirst: 0 },
    };
  }, [dragAssignments, uploadedChoices, activeBandIds]);

  // drag/drop UI state
  const [dragHover, setDragHover] = useState({ workshop: null, invalid: false, message: null });
  const [dropViolations, setDropViolations] = useState({}); // Temporary violations (cleared after 5s)
  const [persistentViolations, setPersistentViolations] = useState({}); // { workshopName: { studentName: message } }
  const scrollContainerRef = React.useRef(null);
  const topScrollbarRef = React.useRef(null);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [studentSearchQuery, setStudentSearchQuery] = useState(''); // Search query for students in drag & drop
  const [addUnassignedQuery, setAddUnassignedQuery] = useState('');
  const [extraUnassignedByBand, setExtraUnassignedByBand] = useState({});
  const studentCardRefs = React.useRef({}); // Refs for student cards to enable scrolling

  // Update window width on resize
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setExtraUnassignedByBand({});
    setAddUnassignedQuery('');
  }, [wahlTrimesterKey]);

  // Sync top and bottom scrollbars
  useEffect(() => {
    const bottomContainer = scrollContainerRef.current;
    const topContainer = topScrollbarRef.current;
    
    if (!bottomContainer || !topContainer) return;

    const handleScroll = () => {
      topContainer.scrollLeft = bottomContainer.scrollLeft;
    };

    const handleTopScroll = () => {
      bottomContainer.scrollLeft = topContainer.scrollLeft;
    };

    bottomContainer.addEventListener('scroll', handleScroll);
    topContainer.addEventListener('scroll', handleTopScroll);

    return () => {
      bottomContainer.removeEventListener('scroll', handleScroll);
      topContainer.removeEventListener('scroll', handleTopScroll);
    };
  });

  // CSV upload handler for student choices
  const [uploadSummary, setUploadSummary] = useState(null);
  const fileInputRefs = React.useRef({});

  // Helper function to parse Q1/Q2 values, ignoring text after colon
  function parseChoiceValue(value) {
    if (!value) return '';
    const trimmed = value.trim();
    // If there's a colon, take only the part before it
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex !== -1) {
      return trimmed.substring(0, colonIndex).trim();
    }
    return trimmed;
  }

  // Helper to parse CSV text with automatic separator detection (semicolon, comma, tab)
  function parseCsvText(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return [];

    // Detect separator from first non-empty line
    const firstLine = lines[0];
    let commaCount = 0;
    let semiCount = 0;
    let tabCount = 0;
    let inQ = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ) {
        if (c === ';') semiCount++;
        else if (c === ',') commaCount++;
        else if (c === '\t') tabCount++;
      }
    }

    let sep = ';';
    if (tabCount > semiCount && tabCount > commaCount) sep = '\t';
    else if (commaCount > semiCount) sep = ',';

    return lines.map(line => {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === sep && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    });
  }

  // Helper function to parse file (CSV or XLSX) into data array
  async function parseFileToData(file) {
    return new Promise((resolve, reject) => {
      const fileName = file.name.toLowerCase();
      const isXLSX = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      
      if (isXLSX) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            resolve(jsonData);
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Fehler beim Lesen der XLSX-Datei.'));
        reader.readAsArrayBuffer(file);
      } else {
        // CSV file
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const text = e.target.result;
            if (text.includes('\uFFFD')) {
              // Try reading as windows-1252 if UTF-8 resulted in invalid replacement characters
              const altReader = new FileReader();
              altReader.onload = (e2) => {
                resolve(parseCsvText(e2.target.result));
              };
              altReader.onerror = () => resolve(parseCsvText(text));
              altReader.readAsText(file, 'windows-1252');
              return;
            }
            resolve(parseCsvText(text));
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Fehler beim Lesen der CSV-Datei.'));
        reader.readAsText(file, 'UTF-8');
      }
    });
  }

  // Auto-detect column mappings based on headers heuristics
  function autoDetectColumnMappings(headers) {
    const mappings = {};
    const usedRoles = new Set();

    headers.forEach((h, idx) => {
      const lower = String(h || '').toLowerCase().trim();
      let role = 'ignore';

      if (lower === 'vorname' || lower.startsWith('vorname') || lower === 'firstname' || lower === 'first name') {
        role = 'firstName';
      } else if (lower === 'nachname' || lower.startsWith('nachname') || lower === 'lastname' || lower === 'last name' || lower === 'familienname') {
        role = 'lastName';
      } else if (
        lower === 'name' || lower.includes('schüler') || lower.includes('schueler') ||
        lower.includes('student') || lower.includes('teilnehmer') || lower.includes('name des kindes') ||
        lower.includes('name der schülerin') || lower.includes('vollständiger name') || lower.includes('ganzer name')
      ) {
        role = 'name';
      } else if (
        lower.includes('klasse') || lower.includes('class') || lower.includes('lerngruppe') ||
        lower.includes('jahrgang') || lower.includes('gruppe') || lower.includes('jg')
      ) {
        role = 'class';
      } else if (
        lower === 'q1' || lower.startsWith('q1') || lower.includes('q1') ||
        lower.includes('erst') || lower.includes('1. wahl') || lower.includes('1. wunsch') ||
        lower.includes('1.wahl') || lower.includes('1.wunsch') || lower.includes('wahl 1') ||
        lower.includes('wunsch 1') || lower.includes('prio 1') || lower.includes('priorität 1') ||
        lower.includes('erstpräferenz') || lower === 'wahl1' || lower === 'wunsch1'
      ) {
        role = 'q1';
      } else if (
        lower === 'q2' || lower.startsWith('q2') || lower.includes('q2') ||
        lower.includes('zweit') || lower.includes('2. wahl') || lower.includes('2. wunsch') ||
        lower.includes('2.wahl') || lower.includes('2.wunsch') || lower.includes('wahl 2') ||
        lower.includes('wunsch 2') || lower.includes('prio 2') || lower.includes('priorität 2') ||
        lower.includes('zweitpräferenz') || lower === 'wahl2' || lower === 'wunsch2'
      ) {
        role = 'q2';
      } else if (
        lower === 'q3' || lower.startsWith('q3') || lower.includes('q3') ||
        lower.includes('dritt') || lower.includes('3. wahl') || lower.includes('3. wunsch') ||
        lower.includes('3.wahl') || lower.includes('3.wunsch') || lower.includes('wahl 3') ||
        lower.includes('wunsch 3') || lower.includes('prio 3') || lower.includes('priorität 3') ||
        lower.includes('drittpräferenz') || lower === 'wahl3' || lower === 'wunsch3'
      ) {
        role = 'q3';
      } else if (
        lower.includes('begleit') || lower.includes('assist') || lower.includes('inklusion') || lower.includes('sonderpäd')
      ) {
        role = 'assistant';
      }

      if (role !== 'ignore' && !usedRoles.has(role)) {
        mappings[idx] = role;
        usedRoles.add(role);
      } else {
        mappings[idx] = 'ignore';
      }
    });

    // Fallback if Q1 not matched: look after class column or at the end
    if (!usedRoles.has('q1')) {
      const classIdx = Object.keys(mappings).find(k => mappings[k] === 'class');
      if (classIdx !== undefined) {
        const remaining = headers.map((_, i) => i).filter(i => mappings[i] === 'ignore' && i > parseInt(classIdx, 10));
        if (remaining.length >= 2) {
          mappings[remaining[0]] = 'q1';
          mappings[remaining[1]] = 'q2';
        } else if (remaining.length === 1) {
          mappings[remaining[0]] = 'q1';
        }
      } else if (headers.length >= 3) {
        const remaining = headers.map((_, i) => i).filter(i => mappings[i] === 'ignore');
        if (remaining.length >= 2) {
          mappings[remaining[remaining.length - 2]] = 'q1';
          mappings[remaining[remaining.length - 1]] = 'q2';
        } else if (remaining.length === 1) {
          mappings[remaining[remaining.length - 1]] = 'q1';
        }
      }
    }

    return mappings;
  }

  // State for Column Mapping Modal
  const [columnMappingModal, setColumnMappingModal] = useState({
    isOpen: false,
    fileName: '',
    targetBand: '',
    rawData: [],
    headers: [],
    previewRows: [],
    totalRows: 0,
    mappings: {},
  });

  function handleColumnMappingChange(colIdx, newRole) {
    setColumnMappingModal(prev => {
      const nextMappings = { ...prev.mappings };
      if (newRole !== 'ignore') {
        Object.keys(nextMappings).forEach(k => {
          if (parseInt(k, 10) !== colIdx && nextMappings[k] === newRole) {
            nextMappings[k] = 'ignore';
          }
        });
      }
      nextMappings[colIdx] = newRole;
      return { ...prev, mappings: nextMappings };
    });
  }

  function handleResetColumnMappings() {
    setColumnMappingModal(prev => ({
      ...prev,
      mappings: autoDetectColumnMappings(prev.headers),
    }));
  }

  function handleConfirmColumnMapping() {
    const { rawData, targetBand, mappings } = columnMappingModal;

    let nameIdx = -1;
    let firstNameIdx = -1;
    let lastNameIdx = -1;
    let klasseIdx = -1;
    let q1Idx = -1;
    let q2Idx = -1;
    let q3Idx = -1;
    let assistantIdx = -1;

    Object.entries(mappings).forEach(([idxStr, role]) => {
      const idx = parseInt(idxStr, 10);
      if (role === 'name') nameIdx = idx;
      if (role === 'firstName') firstNameIdx = idx;
      if (role === 'lastName') lastNameIdx = idx;
      if (role === 'class') klasseIdx = idx;
      if (role === 'q1') q1Idx = idx;
      if (role === 'q2') q2Idx = idx;
      if (role === 'q3') q3Idx = idx;
      if (role === 'assistant') assistantIdx = idx;
    });

    const hasName = nameIdx !== -1 || (firstNameIdx !== -1 && lastNameIdx !== -1);
    if (!hasName) {
      alert('Fehler: Bitte ordnen Sie eine Spalte für den Schüler-Namen (oder Vor- und Nachname) zu.');
      return;
    }
    if (q1Idx === -1) {
      alert('Fehler: Bitte ordnen Sie mindestens eine Spalte für den 1. Wunsch (Q1) zu.');
      return;
    }

    const wahlCount = activeTrimesterWahlCount;
    if (wahlCount >= 2 && q2Idx === -1) {
      alert(`Für dieses Trimester sind ${wahlCount} Wahlen pro Schüler vorgesehen. Bitte ordnen Sie auch eine Spalte für den 2. Wunsch (Q2) zu.`);
      return;
    }
    if (wahlCount >= 3 && q3Idx === -1) {
      alert(`Für dieses Trimester sind ${wahlCount} Wahlen pro Schüler vorgesehen. Bitte ordnen Sie auch eine Spalte für den 3. Wunsch (Q3) zu.`);
      return;
    }

    const summary = {
      newStudents: [],
      updatedClasses: [],
      newWorkshops: [],
      updatedChoices: 0,
      inferredEnrollmentYears: [],
      errors: [],
      band: getBandLabel(targetBand),
    };

    const trimesterKey = getSchoolYearKey(
      yearTrimester.schoolYearStart,
      yearTrimester.schoolYearEnd,
      yearTrimester.trimester
    );
    const newStudentClasses = { ...studentClasses };
    const newClassUploadInfo = { ...studentClassUploadInfo };
    const newStudents = [...students];
    const newWorkshops = { ...workshops };
    const newStudentAssistants = { ...studentAssistants };
    const newEnrollmentYears = { ...studentEnrollmentYears };
    const bandMap = { ...(uploadedChoices[targetBand] || {}) };
    const bandClasses = { ...(uploadedChoices.__classes?.[targetBand] || {}) };

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      let studentName = '';
      if (nameIdx !== -1) {
        studentName = String(row[nameIdx] || '').trim();
      } else if (firstNameIdx !== -1 && lastNameIdx !== -1) {
        const fn = String(row[firstNameIdx] || '').trim();
        const ln = String(row[lastNameIdx] || '').trim();
        studentName = `${fn} ${ln}`.trim();
      }
      if (!studentName) continue;

      const className = klasseIdx >= 0 ? String(row[klasseIdx] || '').trim() : '';
      const q1Value = q1Idx >= 0 ? String(row[q1Idx] || '').trim() : '';
      const q2Value = q2Idx >= 0 ? String(row[q2Idx] || '').trim() : '';
      const q3Value = q3Idx >= 0 ? String(row[q3Idx] || '').trim() : '';

      if (assistantIdx >= 0) {
        const assVal = String(row[assistantIdx] || '').toLowerCase().trim();
        if (
          assVal === 'ja' ||
          assVal === 'yes' ||
          assVal === 'true' ||
          assVal === '1' ||
          assVal === 'x' ||
          assVal.includes('begleit') ||
          assVal.includes('bedarf')
        ) {
          newStudentAssistants[studentName] = true;
        }
      }

      const q1 = parseChoiceValue(q1Value);
      const q2 = parseChoiceValue(q2Value);
      const q3 = parseChoiceValue(q3Value);

      if (!newStudents.includes(studentName)) {
        newStudents.push(studentName);
        summary.newStudents.push(studentName);
      }

      const recordedClass = className || newStudentClasses[studentName] || '';
      if (className) {
        if (newStudentClasses[studentName] !== className) {
          const oldClass = newStudentClasses[studentName];
          newStudentClasses[studentName] = className;
          summary.updatedClasses.push({ student: studentName, old: oldClass || null, new: className });
        }
      }
      if (recordedClass) {
        bandClasses[studentName] = recordedClass;
        rememberClassOnUpload(newClassUploadInfo, studentName, trimesterKey, targetBand, recordedClass);
      }

      const choices = [];
      if (q1) choices.push(q1);
      if (wahlCount >= 2 && q2) choices.push(q2);
      if (wahlCount >= 3 && q3) choices.push(q3);

      const normalizedChoices = choices
        .map((choice) => {
          if (!choice) return '';
          const normalized = parseChoiceValue(choice);
          const existingWorkshop = Object.keys(newWorkshops).find((w) => {
            return parseChoiceValue(w).toLowerCase() === normalized.toLowerCase();
          });
          if (!existingWorkshop && normalized) {
            newWorkshops[normalized] = 6;
            if (!summary.newWorkshops.includes(normalized)) {
              summary.newWorkshops.push(normalized);
            }
          }
          return existingWorkshop || normalized;
        })
        .filter(Boolean)
        .slice(0, wahlCount);

      if (normalizedChoices.length > 0) {
        bandMap[studentName] = normalizedChoices;
        summary.updatedChoices++;

        if (className && getStudentEinschulungsjahr(studentName, newEnrollmentYears) == null) {
          const inferred = inferEinschulungsjahrFromWahlClass(
            yearTrimester.schoolYearStart,
            className
          );
          if (inferred != null) {
            newEnrollmentYears[studentName] = inferred;
            summary.inferredEnrollmentYears.push({
              student: studentName,
              year: inferred,
              className,
            });
          }
        }
      }
    }

    setStudents(newStudents);
    setStudentClasses(newStudentClasses);
    setStudentEnrollmentYears(newEnrollmentYears);
    setStudentClassUploadInfo(newClassUploadInfo);
    setWorkshops(newWorkshops);
    if (assistantIdx >= 0) {
      setStudentAssistants(newStudentAssistants);
    }
    setUploadedChoices((prev) => {
      const updated = {
        ...prev,
        [targetBand]: bandMap,
        __classes: {
          ...(prev.__classes || {}),
          [targetBand]: bandClasses,
        },
      };
      const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
      const choicesKey = `wv_choices_${key}`;
      try {
        localStorage.setItem(choicesKey, JSON.stringify(updated));
        console.log(`💾 Saved choices to ${choicesKey}:`, updated);
      } catch (error) {
        console.error(`Failed to save choices to ${choicesKey}:`, error);
      }
      return updated;
    });

    setUploadSummary(summary);
    setColumnMappingModal((prev) => ({ ...prev, isOpen: false }));

    if (fileInputRefs.current[targetBand]) {
      fileInputRefs.current[targetBand].value = '';
    }

    alert(`Datei erfolgreich hochgeladen für ${summary.band}!\n${summary.updatedChoices} Schüler-Wahlen aktualisiert.`);
  }

  async function handleFileUpload(event, targetBand) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const data = await parseFileToData(file);
      if (!data || data.length === 0) {
        alert('Die Datei ist leer.');
        return;
      }

      const validRows = data.filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim() !== ''));
      if (validRows.length < 2) {
        alert('Die Datei muss mindestens eine Kopfzeile und eine Datenzeile enthalten.');
        return;
      }

      const headers = validRows[0].map((h) => String(h || '').trim());
      const previewRows = validRows.slice(1, 6);
      const initialMappings = autoDetectColumnMappings(headers);

      setColumnMappingModal({
        isOpen: true,
        fileName: file.name,
        targetBand: targetBand,
        rawData: validRows,
        headers: headers,
        previewRows: previewRows,
        totalRows: validRows.length - 1,
        mappings: initialMappings,
      });

      if (event.target) {
        event.target.value = '';
      }
    } catch (error) {
      alert(`Fehler beim Lesen der Datei: ${error.message}`);
    }
  }

  function persistAutoResultForTrimester(res) {
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    save(`wv_autoResult_${key}`, res, false);
  }

  function applyBandResultToDragAssignments(bandId, bandResult, prevDrag) {
    const next = JSON.parse(JSON.stringify(prevDrag));
    if (!next[bandId]) next[bandId] = {};
    students.forEach(s => {
      next[bandId][s] = bandResult.assignments[s] || 'Nicht Zugeordnen';
    });
    return next;
  }

  function runAutoAssignForBand(bandId) {
    const choicesCopy = JSON.parse(JSON.stringify(uploadedChoices));
    const priorWorkshopsByStudent = buildPriorWorkshopsFromOtherBands(
      dragAssignments,
      activeBandIds,
      bandId,
      students
    );
    const { bandResult, problems: bandProblems } = autoAssignOneBandWithPrior(
      students,
      workshops,
      prevAssignments,
      prereqs,
      choicesCopy,
      studentAssistants,
      priorityScoresByStudent,
      rules,
      confirmedAssignments,
      yearTrimester.schoolYearStart,
      yearTrimester.schoolYearEnd,
      yearTrimester.trimester,
      cannotBeParallel,
      bandId,
      priorWorkshopsByStudent,
      studentClasses,
      studentEnrollmentYears,
      activeTrimesterWahlCount,
      allowSelfParallel
    );

    setAutoResult(prev => {
      const bandResults = { ...(prev?.bandResults || {}), [bandId]: bandResult };
      const keptProblems = (prev?.problems || []).filter(p => typeof p !== 'object' || p.band !== bandId);
      const problems = [...keptProblems, ...bandProblems];
      const res = recomputeAutoResultTotals(bandResults, problems, activeBandIds, students);
      persistAutoResultForTrimester(res);
      return res;
    });

    setDragAssignments(prev => applyBandResultToDragAssignments(bandId, bandResult, prev));
  }

  function runAutoAssign() {
    const res = autoAssignAllBands(students, workshops, prevAssignments, prereqs, JSON.parse(JSON.stringify(uploadedChoices)), studentAssistants, priorityScoresByStudent, rules, confirmedAssignments, yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, cannotBeParallel, activeBandIds, studentClasses, studentEnrollmentYears, activeTrimesterWahlCount, allowSelfParallel);
    setAutoResult(res);
    persistAutoResultForTrimester(res);

    const newDragAssignments = createEmptyBandMap();
    for (const s of students) {
      activeBandIds.forEach(bandId => {
        newDragAssignments[bandId][s] = res.bandResults[bandId]?.assignments[s] || 'Nicht Zugeordnen';
      });
    }

    setDragAssignments(newDragAssignments);
  }
  
  // Helper function to format year/trimester in natural language
  function formatYearTrimester(schoolYearStart, schoolYearEnd, trimester) {
    const trimesterNames = {
      1: 'Erstes Trimester',
      2: 'Zweites Trimester',
      3: 'Drittes Trimester'
    };
    return `Schuljahr ${schoolYearStart}/${schoolYearEnd}, ${trimesterNames[trimester]}`;
  }


  function calculatePriorityScoreHistory(student) {
    return computePriorityScoreHistorySeries(student, assignmentsForPriority, load, studentAssistants);
  }

  function calculatePriorityScoreFromHistory(student) {
    return priorityScoresByStudent[student] ?? computePriorityScoreFromFullHistory(
      student,
      assignmentsForPriority,
      load,
      studentAssistants
    );
  }
  

  // NEW: update a past (confirmed) assignment for one student (inline history edit)
  function updateConfirmedAssignmentForStudent(slotKey, student, newWorkshop, band = null) {
    const payload = load(LS_KEYS.assignments, {});
    if (!payload[slotKey]) {
      alert('Eintrag nicht gefunden.');
      return;
    }
    const copy = { ...payload };
    
    if (band && copy[slotKey].assignments[band]) {
      // Multi-Band assignment
      copy[slotKey] = { 
        ...copy[slotKey], 
        assignments: { 
          ...copy[slotKey].assignments, 
          [band]: { ...copy[slotKey].assignments[band], [student]: newWorkshop }
        } 
      };
    } else {
      // Legacy single assignment format
      copy[slotKey] = { ...copy[slotKey], assignments: { ...copy[slotKey].assignments, [student]: newWorkshop } };
    }
    
    save(LS_KEYS.assignments, copy);
    setConfirmedAssignments(copy);
  }

  // Excel Report generation functions - generates one Excel file with all classes (multiple sheets)
  function generateExcelAllClassesReport() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    const wb = XLSX.utils.book_new();
    
    // Group students by class
    const studentsByClass = {};
    students.forEach(student => {
      const className = studentClasses[student] || 'Unbekannt';
      if (!studentsByClass[className]) {
        studentsByClass[className] = [];
      }
      studentsByClass[className].push(student);
    });
    
    // Sort classes
    const sortedClasses = Object.keys(studentsByClass).sort();
    
    // Generate sheet for each class
    sortedClasses.forEach((className) => {
      const classStudents = studentsByClass[className].sort((a, b) => a.localeCompare(b));
      
      // Prepare table data with title rows first
      const tableData = [
        [`Klasse: ${className}`],
        [`${reportYearTrimester.schoolYearStart}-${reportYearTrimester.schoolYearEnd} - Trimester ${reportYearTrimester.trimester}`],
        [`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`],
        [], // Empty row
        ['Schüler', 'Band', 'Werkstatt', 'Raum', 'Lehrer'] // Header row
      ];
      
      classStudents.forEach(student => {
        buildStudentReportRows(student, assignments, reportBandIds, workshopRooms, workshopTeachers)
          .forEach(row => tableData.push(row));
      });
      
      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(tableData);
      
      // Set column widths
      ws['!cols'] = [
        { wch: 25 }, // Schüler
        { wch: 12 }, // Band
        { wch: 30 }, // Werkstatt
        { wch: 12 }, // Raum
        { wch: 20 }  // Lehrer
      ];
      
      // Add worksheet to workbook (sheet name must be <= 31 chars and cannot contain : \ / ? * [ ])
      const safeSheetName = className
        .replace(/[:\\/?*[\]]/g, '_')
        .substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    });
    
    // Save Excel file
    const filename = `Klassen-Berichte_Alle_${key}.xlsx`;
    XLSX.writeFile(wb, filename);
  }
  
  // Excel Report generation functions - generates one Excel file per class
  function generateExcelClassReports() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    
    // Group students by class
    const studentsByClass = {};
    students.forEach(student => {
      const className = studentClasses[student] || 'Unbekannt';
      if (!studentsByClass[className]) {
        studentsByClass[className] = [];
      }
      studentsByClass[className].push(student);
    });
    
    // Sort classes
    const sortedClasses = Object.keys(studentsByClass).sort();
    
    // Generate one Excel file per class
    sortedClasses.forEach((className) => {
      const wb = XLSX.utils.book_new();
      const classStudents = studentsByClass[className].sort((a, b) => a.localeCompare(b));
      
      // Prepare table data with title rows first
      const tableData = [
        [`Klasse: ${className}`],
        [`${reportYearTrimester.schoolYearStart}-${reportYearTrimester.schoolYearEnd} - Trimester ${reportYearTrimester.trimester}`],
        [`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`],
        [], // Empty row
        ['Schüler', 'Band', 'Werkstatt', 'Raum', 'Lehrer'] // Header row
      ];
      
      classStudents.forEach(student => {
        buildStudentReportRows(student, assignments, reportBandIds, workshopRooms, workshopTeachers)
          .forEach(row => tableData.push(row));
      });
      
      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(tableData);
      
      // Set column widths
      ws['!cols'] = [
        { wch: 25 }, // Schüler
        { wch: 12 }, // Band
        { wch: 30 }, // Werkstatt
        { wch: 12 }, // Raum
        { wch: 20 }  // Lehrer
      ];
      
      XLSX.utils.book_append_sheet(wb, ws, 'Klasse');
      
      // Save Excel file
      const safeClassName = className.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `Klasse_${safeClassName}_${key}.xlsx`;
      XLSX.writeFile(wb, filename);
    });
  }
  
  // Excel Report generation functions - generates one Excel file with all workshops (multiple sheets)
  function generateExcelAllWorkshopsReport() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    const wb = XLSX.utils.book_new();
    
    // Sort workshops alphabetically
    const sortedWorkshops = Object.keys(workshops).sort();
    
    // Generate sheet for each workshop
    sortedWorkshops.forEach((workshopName) => {
      const capacity = getWorkshopCapacity(workshops[workshopName], workshopName);
      const teacher = workshopTeachers[workshopName] || 'Nicht zugeordnet';
      const room = workshopRooms[workshopName] || 'Nicht zugeordnet';
      
      const studentsByBand = getWorkshopStudentsByBand(assignments, workshopName, reportBandIds);
      
      const tableData = [];
      
      tableData.push([workshopName]);
      tableData.push([`Lehrkraft: ${teacher}`]);
      tableData.push([`Raum: ${room}`]);
      tableData.push([`Kapazität: ${capacity} Plätze`]);
      tableData.push([]);
      
      appendWorkshopBandExcelSections(tableData, studentsByBand, reportBandIds, studentClasses, studentAssistants, studentComments);
      
      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(tableData);
      
      // Set column widths
      ws['!cols'] = [
        { wch: 25 }, // Schüler
        { wch: 15 }, // Klasse
        { wch: 40 }, // Bemerkung
        { wch: 15 }  // Lernbegleitung
      ];
      
      // Add worksheet to workbook (sheet name must be <= 31 chars and cannot contain : \ / ? * [ ])
      const safeSheetName = workshopName
        .replace(/[:\\/?*[\]]/g, '_')
        .substring(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    });
    
    // Save Excel file
    const filename = `Werkstatt-Uebersicht_Alle_${key}.xlsx`;
    XLSX.writeFile(wb, filename);
  }
  
  // Excel Report generation functions - generates one Excel file per workshop
  function generateExcelWorkshopReports() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    
    // Sort workshops alphabetically
    const sortedWorkshops = Object.keys(workshops).sort();
    
    // Generate one Excel file per workshop
    sortedWorkshops.forEach((workshopName) => {
      const wb = XLSX.utils.book_new();
      const capacity = getWorkshopCapacity(workshops[workshopName], workshopName);
      const teacher = workshopTeachers[workshopName] || 'Nicht zugeordnet';
      const room = workshopRooms[workshopName] || 'Nicht zugeordnet';
      
      const studentsByBand = getWorkshopStudentsByBand(assignments, workshopName, reportBandIds);
      
      const tableData = [];
      
      tableData.push([workshopName]);
      tableData.push([`${reportYearTrimester.schoolYearStart}-${reportYearTrimester.schoolYearEnd} - Trimester ${reportYearTrimester.trimester}`]);
      tableData.push([`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`]);
      tableData.push([]);
      tableData.push([`Lehrkraft: ${teacher}`]);
      tableData.push([`Raum: ${room}`]);
      tableData.push([`Kapazität: ${capacity} Plätze`]);
      tableData.push([]);
      
      appendWorkshopBandExcelSections(tableData, studentsByBand, reportBandIds, studentClasses, studentAssistants, studentComments);
      
      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(tableData);
      
      // Set column widths
      ws['!cols'] = [
        { wch: 25 }, // Schüler
        { wch: 15 }, // Klasse
        { wch: 40 }, // Bemerkung
        { wch: 15 }  // Lernbegleitung
      ];
      
      XLSX.utils.book_append_sheet(wb, ws, 'Werkstatt');
      
      // Save Excel file
      const safeWorkshopName = workshopName.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `Werkstatt_${safeWorkshopName}_${key}.xlsx`;
      XLSX.writeFile(wb, filename);
    });
  }
  
  // PDF Report generation functions - generates one PDF with all classes
  function generatePDFAllClassesReport() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    
    // Create new PDF document
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    
    // Helper function to add a new page if needed
    const checkPageBreak = (requiredSpace = 20) => {
      if (yPos + requiredSpace > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
        return true;
      }
      return false;
    };
    
    // Title page
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('Klassen-Berichte', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;
    
    doc.setFontSize(16);
    doc.setFont(undefined, 'normal');
    doc.text(`${reportYearTrimester.schoolYearStart}-${reportYearTrimester.schoolYearEnd} - Trimester ${reportYearTrimester.trimester}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;
    
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 20;
    
    // Group students by class
    const studentsByClass = {};
    students.forEach(student => {
      const className = studentClasses[student] || 'Unbekannt';
      if (!studentsByClass[className]) {
        studentsByClass[className] = [];
      }
      studentsByClass[className].push(student);
    });
    
    // Sort classes
    const sortedClasses = Object.keys(studentsByClass).sort();
    
    // Generate report for each class in one document
    sortedClasses.forEach((className, classIndex) => {
      checkPageBreak(40);
      
      // Class header
      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(`Klasse: ${className}`, 20, yPos);
      yPos += 10;
      
      const classStudents = studentsByClass[className].sort((a, b) => a.localeCompare(b));
      
      // Prepare table data - each student gets two rows (one per band)
      const tableData = [];
      classStudents.forEach(student => {
        buildStudentReportRows(student, assignments, reportBandIds, workshopRooms, workshopTeachers)
          .forEach(row => tableData.push(row));
      });
      
      // Add table
      autoTable(doc, {
        startY: yPos,
        head: [['Schüler', 'Band', 'Werkstatt', 'Raum', 'Lehrer']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: {
          0: { cellWidth: 45, fontStyle: 'bold' },
          1: { cellWidth: 25, fontStyle: 'normal' },
          2: { cellWidth: 50 },
          3: { cellWidth: 25 },
          4: { cellWidth: 40 }
        },
        didParseCell: function(data) {
          // Don't modify header cells - they should use headStyles
          if (data.section === 'head') {
            return;
          }
          
          // Style the first column: bold for student names, italic/light for empty cells
          if (data.column.index === 0) {
            if (data.cell.text[0] === '') {
              data.cell.styles.fontStyle = 'italic';
              data.cell.styles.textColor = [200, 200, 200];
            } else {
              data.cell.styles.fontStyle = 'bold';
            }
          }
          // Style the band column (body cells only)
          if (data.column.index === 1) {
            data.cell.styles.fontStyle = 'normal';
            data.cell.styles.textColor = [100, 100, 100];
          }
        },
        margin: { left: 20, right: 20 }
      });
      
      // Update yPos after table
      yPos = doc.lastAutoTable.finalY + 15;
      
      // Add spacing between classes
      if (classIndex < sortedClasses.length - 1) {
        checkPageBreak(20);
        yPos += 5;
      }
    });
    
    // Save PDF
    const filename = `Klassen-Berichte_Alle_${key}.pdf`;
    doc.save(filename);
  }

  // PDF Report generation functions - generates one PDF per class
  function generatePDFClassReports() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    
    // Group students by class
    const studentsByClass = {};
    students.forEach(student => {
      const className = studentClasses[student] || 'Unbekannt';
      if (!studentsByClass[className]) {
        studentsByClass[className] = [];
      }
      studentsByClass[className].push(student);
    });
    
    // Sort classes
    const sortedClasses = Object.keys(studentsByClass).sort();
    
    // Generate one PDF per class
    sortedClasses.forEach((className) => {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      let yPos = 20;
      
      // Title
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text(`Klasse: ${className}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 10;
      
      doc.setFontSize(16);
      doc.setFont(undefined, 'normal');
      doc.text(`${reportYearTrimester.schoolYearStart}-${reportYearTrimester.schoolYearEnd} - Trimester ${reportYearTrimester.trimester}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 15;
      
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 20;
      
      const classStudents = studentsByClass[className].sort((a, b) => a.localeCompare(b));
      
      // Prepare table data - each student gets two rows (one per band)
      const tableData = [];
      classStudents.forEach(student => {
        buildStudentReportRows(student, assignments, reportBandIds, workshopRooms, workshopTeachers)
          .forEach(row => tableData.push(row));
      });
      
      // Add table
      autoTable(doc, {
        startY: yPos,
        head: [['Schüler', 'Band', 'Werkstatt', 'Raum', 'Lehrer']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: {
          0: { cellWidth: 45, fontStyle: 'bold' },
          1: { cellWidth: 25, fontStyle: 'normal' },
          2: { cellWidth: 50 },
          3: { cellWidth: 25 },
          4: { cellWidth: 40 }
        },
        didParseCell: function(data) {
          // Don't modify header cells - they should use headStyles
          if (data.section === 'head') {
            return;
          }
          
          // Style the first column: bold for student names, italic/light for empty cells
          if (data.column.index === 0) {
            if (data.cell.text[0] === '') {
              data.cell.styles.fontStyle = 'italic';
              data.cell.styles.textColor = [200, 200, 200];
            } else {
              data.cell.styles.fontStyle = 'bold';
            }
          }
          // Style the band column (body cells only)
          if (data.column.index === 1) {
            data.cell.styles.fontStyle = 'normal';
            data.cell.styles.textColor = [100, 100, 100];
          }
        },
        margin: { left: 20, right: 20 }
      });
      
      // Save PDF for this class
      const safeClassName = className.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `Klasse_${safeClassName}_${key}.pdf`;
      doc.save(filename);
    });
  }

  // PDF Report generation functions - generates one PDF with all workshops
  function generatePDFAllWorkshopsReport() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    
    // Create new PDF document
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    
    // Helper function to add a new page if needed
    const checkPageBreak = (requiredSpace = 20) => {
      if (yPos + requiredSpace > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
        return true;
      }
      return false;
    };
    
    // Title page
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('Werkstatt-Übersicht', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;
    
    doc.setFontSize(16);
    doc.setFont(undefined, 'normal');
    doc.text(`${reportYearTrimester.schoolYearStart}-${reportYearTrimester.schoolYearEnd} - Trimester ${reportYearTrimester.trimester}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;
    
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, pageWidth / 2, yPos, { align: 'center' });
    yPos += 20;
    
    // Sort workshops alphabetically
    const sortedWorkshops = Object.keys(workshops).sort();
    
    // Generate report for each workshop in one document
    sortedWorkshops.forEach((workshopName, workshopIndex) => {
      checkPageBreak(50);
      
      const capacity = getWorkshopCapacity(workshops[workshopName], workshopName);
      const teacher = workshopTeachers[workshopName] || 'Nicht zugeordnet';
      const room = workshopRooms[workshopName] || 'Nicht zugeordnet';
      
      // Workshop header
      doc.setFontSize(18);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(workshopName, 20, yPos);
      yPos += 8;
      
      // Workshop details
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text(`Lehrkraft: ${teacher}`, 20, yPos);
      yPos += 6;
      doc.text(`Raum: ${room}`, 20, yPos);
      yPos += 6;
      doc.text(`Kapazität: ${capacity} Plätze`, 20, yPos);
      yPos += 10;
      
      const studentsByBand = getWorkshopStudentsByBand(assignments, workshopName, reportBandIds);
      const hasAnyStudents = reportBandIds.some(bandId => (studentsByBand[bandId] || []).length > 0);

      if (hasAnyStudents) {
        reportBandIds.forEach(bandId => {
          const bandStudents = studentsByBand[bandId] || [];
          if (bandStudents.length === 0) return;

          checkPageBreak(30);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text(`${getBandLabel(bandId)}:`, 20, yPos);
          yPos += 8;

          const bandTableData = bandStudents.map(student => {
            const className = studentClasses[student] || 'Unbekannt';
            const needsAssistant = studentAssistants[student] ? 'Ja' : 'Nein';
            const comment = studentComments[student] || '';
            return [student, className, comment, needsAssistant];
          });

          autoTable(doc, {
            startY: yPos,
            head: [['Schüler', 'Klasse', 'Bemerkung', 'Lernbegleitung']],
            body: bandTableData,
            theme: 'striped',
            headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 1 },
            columnStyles: {
              0: { cellWidth: 40 },
              1: { cellWidth: 25 },
              2: { cellWidth: 80, cellMinWidth: 80 },
              3: { cellWidth: 25 }
            },
            margin: { left: 15, right: 15 }
          });

          yPos = doc.lastAutoTable.finalY + 15;
        });
      } else {
        doc.setFont(undefined, 'italic');
        doc.setTextColor(150, 150, 150);
        doc.text('Keine Schüler zugeordnet', 20, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 10;
      }
      
      // Add spacing between workshops
      if (workshopIndex < sortedWorkshops.length - 1) {
        checkPageBreak(20);
        yPos += 5;
      }
    });
    
    // Save PDF
    const filename = `Werkstatt-Uebersicht_Alle_${key}.pdf`;
    doc.save(filename);
  }

  // PDF Report generation functions - generates one PDF per workshop
  function generatePDFWorkshopReports() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    const reportBandIds = getPayloadBandIds(assignmentData);
    
    // Sort workshops alphabetically
    const sortedWorkshops = Object.keys(workshops).sort();
    
    // Generate one PDF per workshop
    sortedWorkshops.forEach((workshopName) => {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPos = 20;
      
      // Helper function to add a new page if needed
      const checkPageBreak = (requiredSpace = 20) => {
        if (yPos + requiredSpace > pageHeight - 20) {
          doc.addPage();
          yPos = 20;
          return true;
        }
        return false;
      };
      
      const capacity = getWorkshopCapacity(workshops[workshopName], workshopName);
      const teacher = workshopTeachers[workshopName] || 'Nicht zugeordnet';
      const room = workshopRooms[workshopName] || 'Nicht zugeordnet';
      
      // Title
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text(workshopName, pageWidth / 2, yPos, { align: 'center' });
      yPos += 10;
      
      doc.setFontSize(16);
      doc.setFont(undefined, 'normal');
      doc.text(`${reportYearTrimester.schoolYearStart}-${reportYearTrimester.schoolYearEnd} - Trimester ${reportYearTrimester.trimester}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 15;
      
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, pageWidth / 2, yPos, { align: 'center' });
      yPos += 20;
      
      // Workshop details
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0, 0, 0);
      doc.text(`Lehrkraft: ${teacher}`, 20, yPos);
      yPos += 6;
      doc.text(`Raum: ${room}`, 20, yPos);
      yPos += 6;
      doc.text(`Kapazität: ${capacity} Plätze`, 20, yPos);
      yPos += 10;
      
      const studentsByBand = getWorkshopStudentsByBand(assignments, workshopName, reportBandIds);
      const hasAnyStudents = reportBandIds.some(bandId => (studentsByBand[bandId] || []).length > 0);

      if (hasAnyStudents) {
        reportBandIds.forEach(bandId => {
          const bandStudents = studentsByBand[bandId] || [];
          if (bandStudents.length === 0) return;

          checkPageBreak(30);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text(`${getBandLabel(bandId)}:`, 20, yPos);
          yPos += 8;

          const bandTableData = bandStudents.map(student => {
            const className = studentClasses[student] || 'Unbekannt';
            const needsAssistant = studentAssistants[student] ? 'Ja' : 'Nein';
            const comment = studentComments[student] || '';
            return [student, className, comment, needsAssistant];
          });

          autoTable(doc, {
            startY: yPos,
            head: [['Schüler', 'Klasse', 'Bemerkung', 'Lernbegleitung']],
            body: bandTableData,
            theme: 'striped',
            headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 1 },
            columnStyles: {
              0: { cellWidth: 40 },
              1: { cellWidth: 25 },
              2: { cellWidth: 80, cellMinWidth: 80 },
              3: { cellWidth: 25 }
            },
            margin: { left: 15, right: 15 }
          });

          yPos = doc.lastAutoTable.finalY + 15;
        });
      } else {
        doc.setFont(undefined, 'italic');
        doc.setTextColor(150, 150, 150);
        doc.text('Keine Schüler zugeordnet', 20, yPos);
        doc.setTextColor(0, 0, 0);
      }
      
      // Save PDF for this workshop
      const safeWorkshopName = workshopName.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `Werkstatt_${safeWorkshopName}_${key}.pdf`;
      doc.save(filename);
    });
  }

  // Data export/import functions
  async function handleExportAllData() {
    try {
      const allData = {
        [LS_KEYS.students]: students,
        [LS_KEYS.workshops]: workshops,
        [LS_KEYS.prevAssignments]: prevAssignments,
        [LS_KEYS.prereqs]: prereqs,
        [LS_KEYS.cannotBeParallel]: cannotBeParallel,
        [LS_KEYS.rules]: rules,
        [LS_KEYS.studentTrimesters]: studentTrimesters,
        [LS_KEYS.studentAssistants]: studentAssistants,
        [LS_KEYS.studentClasses]: studentClasses,
        [LS_KEYS.studentEnrollmentYears]: studentEnrollmentYears,
        [LS_KEYS.classRegistry]: classRegistry,
        [LS_KEYS.klassenStufenPool]: klassenStufenPool,
        [LS_KEYS.studentClassUploadInfo]: studentClassUploadInfo,
        [LS_KEYS.allowSelfParallel]: allowSelfParallel,
        [LS_KEYS.studentPriorityScores]: studentPriorityScores,
        [LS_KEYS.studentPriorityScoresLastChanged]: studentPriorityScoresLastChanged,
        [LS_KEYS.workshopColors]: workshopColors,
        [LS_KEYS.studentComments]: studentComments,
        [LS_KEYS.manualRuleChecks]: manualRuleChecks,
        [LS_KEYS.workshopTeachers]: workshopTeachers,
        [LS_KEYS.workshopRooms]: workshopRooms,
        [LS_KEYS.archivedWorkshops]: archivedWorkshops,
        [LS_KEYS.trimesterPlans]: trimesterPlans,
        [LS_KEYS.assignments]: confirmedAssignments
      };
      
      const filename = await exportAllDataAsZIP(allData);
      alert(`Alle Daten wurden erfolgreich als ZIP-Datei exportiert: ${filename}`);
    } catch (error) {
      alert(`Fehler beim Exportieren: ${error.message}`);
    }
  }

  async function handleImportData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.zip')) {
      alert('Bitte wählen Sie eine ZIP-Datei aus.');
      return;
    }
    
    try {
      const importedData = await importDataFromZIP(file);
      
      // Confirm before overwriting
      if (!window.confirm('Möchten Sie alle aktuellen Daten mit den importierten Daten überschreiben?')) {
        return;
      }
      
      // Update all state
      if (importedData[LS_KEYS.students]) setStudents(importedData[LS_KEYS.students]);
      if (importedData[LS_KEYS.workshops]) setWorkshops(importedData[LS_KEYS.workshops]);
      if (importedData[LS_KEYS.prevAssignments]) setPrevAssignments(importedData[LS_KEYS.prevAssignments]);
      if (importedData[LS_KEYS.prereqs]) setPrereqs(importedData[LS_KEYS.prereqs]);
      if (importedData[LS_KEYS.cannotBeParallel]) setCannotBeParallel(importedData[LS_KEYS.cannotBeParallel]);
      if (importedData[LS_KEYS.rules]) setRules(importedData[LS_KEYS.rules]);
      if (importedData[LS_KEYS.studentTrimesters]) setStudentTrimesters(importedData[LS_KEYS.studentTrimesters]);
      if (importedData[LS_KEYS.studentAssistants]) setStudentAssistants(importedData[LS_KEYS.studentAssistants]);
      if (importedData[LS_KEYS.studentClasses]) setStudentClasses(importedData[LS_KEYS.studentClasses]);
      if (importedData[LS_KEYS.studentEnrollmentYears]) setStudentEnrollmentYears(importedData[LS_KEYS.studentEnrollmentYears]);
      if (importedData[LS_KEYS.classRegistry]) setClassRegistry(importedData[LS_KEYS.classRegistry]);
      if (importedData[LS_KEYS.klassenStufenPool]) setKlassenStufenPool(importedData[LS_KEYS.klassenStufenPool]);
      if (importedData[LS_KEYS.studentClassUploadInfo]) setStudentClassUploadInfo(importedData[LS_KEYS.studentClassUploadInfo]);
      if (importedData[LS_KEYS.allowSelfParallel]) setAllowSelfParallel(importedData[LS_KEYS.allowSelfParallel]);
      if (importedData[LS_KEYS.studentPriorityScores]) setStudentPriorityScores(importedData[LS_KEYS.studentPriorityScores]);
      // Import studentPriorityScoresLastChanged if present (backward compatible - skip if not present)
      if (importedData[LS_KEYS.studentPriorityScoresLastChanged]) {
        setStudentPriorityScoresLastChanged(importedData[LS_KEYS.studentPriorityScoresLastChanged]);
      }
      if (importedData[LS_KEYS.workshopColors]) setWorkshopColors(importedData[LS_KEYS.workshopColors]);
      if (importedData[LS_KEYS.studentComments]) setStudentComments(importedData[LS_KEYS.studentComments]);
      if (importedData[LS_KEYS.manualRuleChecks]) setManualRuleChecks(importedData[LS_KEYS.manualRuleChecks]);
      if (importedData[LS_KEYS.workshopTeachers]) setWorkshopTeachers(importedData[LS_KEYS.workshopTeachers]);
      if (importedData[LS_KEYS.workshopRooms]) setWorkshopRooms(importedData[LS_KEYS.workshopRooms]);
      if (importedData[LS_KEYS.archivedWorkshops]) setArchivedWorkshops(importedData[LS_KEYS.archivedWorkshops]);
      const nextAssignments = importedData.assignments || confirmedAssignments;
      if (importedData.assignments) {
        setConfirmedAssignments(importedData.assignments);
      }

      // Import choices for all trimesters (stored with pattern wv_choices_${key})
      Object.keys(importedData).forEach(key => {
        if (key.startsWith('wv_choices_')) {
          const choicesData = importedData[key];
          if (choicesData && hasAnyChoicesInBands(choicesData, ALL_BAND_IDS)) {
            save(key, choicesData, false); // Don't auto-export choices
          }
        }
      });

      const importedWorkshops = importedData[LS_KEYS.workshops] || workshops;
      const importedRegistry = importedData[LS_KEYS.classRegistry] || classRegistry;
      const importedPool = mergeKlassenStufenPool(
        importedData[LS_KEYS.klassenStufenPool] ?? klassenStufenPool,
        importedRegistry
      );
      const explicitPlans = importedData[LS_KEYS.trimesterPlans]
        ? normalizeTrimesterPlans(importedData[LS_KEYS.trimesterPlans])
        : {};
      const mergedPlans = buildInferredTrimesterPlans({
        confirmedAssignments: nextAssignments,
        choicesBySlotKey: collectChoicesBySlotKeyFromImport(importedData),
        klassenStufenPool: importedPool,
        workshopNames: Object.keys(importedWorkshops),
        existingPlans: explicitPlans,
      });
      setTrimesterPlans(mergedPlans);
      save(LS_KEYS.trimesterPlans, mergedPlans, false);

      const inferredOnly = !importedData[LS_KEYS.trimesterPlans];
      alert(
        inferredOnly
          ? 'Daten importiert. Trimester-Pläne wurden aus Zuordnungen/Wahl-CSVs ergänzt (älteres ZIP ohne trimester-plans.json).'
          : 'Daten wurden erfolgreich importiert (inkl. Trimester-Konfiguration).'
      );
      
      // Reset file input
      event.target.value = '';
    } catch (error) {
      alert(`Fehler beim Importieren: ${error.message}`);
      event.target.value = '';
    }
  }

  function handleClearAllData() {
    if (window.confirm('Möchten Sie wirklich alle Daten löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
      localStorage.clear();
      window.location.reload();
    }
  }

  // Drag-and-drop helpers
  function canAssign(student, workshopName, band) {
    if (!isWorkshopAvailableInBand(workshops, workshopName, band)) {
      return { ok: false, reason: `Diese Werkstatt ist in ${getBandLabel(band)} nicht verfügbar.` };
    }
    if (activeTrimesterPlan?.courses[workshopName]?.enabled === false) {
      return { ok: false, reason: 'Kurs ist in diesem Trimester nicht angeboten.' };
    }
    if (activeTrimesterPlan && !isWorkshopOfferedInBand(activeTrimesterPlan, workshopName, band)) {
      return { ok: false, reason: `Kurs ist in ${getBandLabel(band)} für dieses Trimester nicht verfügbar.` };
    }
    
    for (const otherBandId of activeBandIds) {
      if (otherBandId === band) continue;
      const otherBandAssignment = dragAssignments[otherBandId]?.[student];
      if (!otherBandAssignment || isNotAssigned(otherBandAssignment)) continue;

      if (otherBandAssignment === workshopName && !courseAllowsSelfParallel(workshopName, allowSelfParallel)) {
        return { ok: false, reason: `Nicht parallel zu sich selbst: bereits in ${getBandLabel(otherBandId)} zugeordnet.` };
      }

      const otherBandCannotBeParallel = cannotBeParallel[otherBandAssignment] || [];
      if (otherBandCannotBeParallel.includes(workshopName)) {
        return { ok: false, reason: `Kann nicht parallel zu ${otherBandAssignment} (${getBandLabel(otherBandId)}) belegt werden.` };
      }
      const thisWorkshopCannotBeParallel = cannotBeParallel[workshopName] || [];
      if (thisWorkshopCannotBeParallel.includes(otherBandAssignment)) {
        return { ok: false, reason: `Kann nicht parallel zu ${otherBandAssignment} (${getBandLabel(otherBandId)}) belegt werden.` };
      }
    }
    
    const counts = getCurrentWorkshopCounts();
    const capacity =
      band === activeBand
        ? getWahlWorkshopCapacity(workshopName)
        : getWorkshopCapacity(workshops[workshopName], workshopName);
    if ((counts[workshopName] ?? 0) >= capacity) {
      return { ok: false, reason: `Kapazität erreicht (${counts[workshopName]}/${capacity})` };
    }
    const last = prevAssignments[student];
    if (last && last === workshopName) {
      return { ok: false, reason: `Schüler hatte diese Werkstatt bereits letztes Jahr (${last}).` };
    }
    if (!hasPrereqs(student, workshopName, prevAssignments, prereqs)) {
      return { ok: false, reason: `Voraussetzungen für ${workshopName} nicht erfüllt.` };
    }

    const requiredFolgekurs = getRequiredFolgekurs(student, rules, confirmedAssignments, yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, band, studentClasses, studentEnrollmentYears);
    if (requiredFolgekurs) {
      const isFulfilled = isFolgekursFulfilled(requiredFolgekurs, dragAssignments, student, activeBandIds);
      if (requiredFolgekurs.band !== null) {
        if (requiredFolgekurs.band === band) {
          if (!isFulfilled && requiredFolgekurs.course !== workshopName) {
            const prevKey = getPreviousTrimesterKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
            return { 
              ok: false, 
              reason: `Folgekurs-Regel: Schüler muss ${requiredFolgekurs.course} belegen (hat im vorherigen Trimester ${prevKey} einen Kurs belegt, der diese Regel auslöst).` 
            };
          }
        } else if (workshopName === requiredFolgekurs.course) {
          return { 
            ok: false, 
            reason: `Folgekurs-Regel: ${requiredFolgekurs.course} muss im ${getBandLabel(requiredFolgekurs.band)} belegt werden (gleiches Band wie im vorherigen Trimester erforderlich).` 
          };
        }
      } else if (!isFulfilled && requiredFolgekurs.course !== workshopName) {
        const prevKey = getPreviousTrimesterKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
        return { 
          ok: false, 
          reason: `Folgekurs-Regel: Schüler muss ${requiredFolgekurs.course} belegen (hat im vorherigen Trimester ${prevKey} einen Kurs belegt, der diese Regel auslöst).` 
        };
      }
    }

    return { ok: true, reason: null };
  }

  function handleDragStart(e, student) {
    e.dataTransfer.setData('text/plain', student);
    // For Firefox
    e.dataTransfer.effectAllowed = 'move';
    
    // Store initial scroll position
    const container = scrollContainerRef.current;
    if (container) {
      let lastX = e.clientX;
      let lastTime = Date.now();
      
      // Auto-scroll on drag
      const handleDrag = (event) => {
        if (!container) return;
        
        const now = Date.now();
        const deltaTime = now - lastTime;
        const deltaX = event.clientX - lastX;
        lastX = event.clientX;
        lastTime = now;
        
        if (Math.abs(deltaX) < 5 && deltaTime > 10) {
          // Get mouse position relative to container
          const containerRect = container.getBoundingClientRect();
          const mouseX = event.clientX - containerRect.left;
          
          // Define scroll zone (50px from edges)
          const scrollZone = 50;
          const totalWidth = containerRect.width;
          
          if (mouseX < scrollZone && container.scrollLeft > 0) {
            // Scroll left
            container.scrollLeft -= (scrollZone - mouseX) / 2;
          } else if (mouseX > totalWidth - scrollZone && container.scrollLeft < container.scrollWidth - totalWidth) {
            // Scroll right
            container.scrollLeft += (mouseX - (totalWidth - scrollZone)) / 2;
          }
        }
      };
      
      document.addEventListener('dragover', handleDrag);
      document.addEventListener('dragend', () => {
        document.removeEventListener('dragover', handleDrag);
      }, { once: true });
    }
  }

  function handleDragOver(e, workshopName) {
    e.preventDefault(); // allow drop
    const student = e.dataTransfer.getData('text/plain');
    if (!student) return;
    
    const conflictBand = activeBandIds.find(otherBandId => {
      if (otherBandId === activeBand) return false;
      const otherAssignment = dragAssignments[otherBandId]?.[student];
      return otherAssignment === workshopName && !isNotAssigned(workshopName);
    });
    if (conflictBand) {
      setDragHover({ 
        workshop: workshopName, 
        invalid: true, 
        message: `Konflikt: Bereits in ${getBandLabel(conflictBand)} zugeordnet` 
      });
      return;
    }
    
    const check = canAssign(student, workshopName, activeBand);
    setDragHover({ workshop: workshopName, invalid: !check.ok, message: check.reason });
  }

  function handleDragEnter(e, workshopName) {
    e.preventDefault();
    const student = e.dataTransfer.getData('text/plain');
    if (!student) return;
    const check = canAssign(student, workshopName);
    setDragHover({ workshop: workshopName, invalid: !check.ok, message: check.reason });
  }

  function handleDragLeave(e, workshopName) {
    setDragHover({ workshop: null, invalid: false, message: null });
  }

  function handleDrop(e, workshopName) {
    e.preventDefault();
    const student = e.dataTransfer.getData('text/plain');
    if (!student) return;
    
    const conflictBand = activeBandIds.find(otherBandId => {
      if (otherBandId === activeBand) return false;
      const otherAssignment = dragAssignments[otherBandId]?.[student];
      return otherAssignment === workshopName && !isNotAssigned(workshopName);
    });
    if (conflictBand) {
      const errorMsg = `Kann nicht zugeordnet werden: ${student} ist bereits in ${getBandLabel(conflictBand)} ${workshopName} zugeordnet.`;
      setDropViolations(prev => ({ ...prev, [workshopName]: errorMsg }));
      setTimeout(() => setDropViolations(prev => {
        const copy = { ...prev };
        delete copy[workshopName];
        return copy;
      }), 5000);
      return;
    }
    
    const check = canAssign(student, workshopName, activeBand);
    
    // Get previous assignment to clear violations from old workshop
    const previousAssignment = getAssignmentsForBand(activeBand)[student];
    
    // Always perform assignment, even if rules are broken
    // (State update is now handled at the end of the function with auto-save)
    
    // Clear violations from previous workshop
    if (previousAssignment && previousAssignment !== workshopName) {
      setPersistentViolations(prev => {
        const updated = { ...prev };
        if (updated[previousAssignment] && updated[previousAssignment][student]) {
          const copy = { ...updated[previousAssignment] };
          delete copy[student];
          if (Object.keys(copy).length === 0) {
            delete updated[previousAssignment];
          } else {
            updated[previousAssignment] = copy;
          }
        }
        return updated;
      });
    }
    
    // Track violations persistently for new assignment
    if (!check.ok) {
      setPersistentViolations(prev => ({
      ...prev, 
        [workshopName]: {
          ...prev[workshopName],
          [student]: check.reason
        }
      }));
    } else {
      // Also check for Folgekurs rule violations even if other checks pass
      const requiredFolgekurs = getRequiredFolgekurs(student, rules, confirmedAssignments, yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, activeBand, studentClasses, studentEnrollmentYears);
      if (requiredFolgekurs) {
        // Check if the rule is already fulfilled in the current assignments (after this drop)
        const updatedAssignments = { ...dragAssignments };
        updatedAssignments[activeBand] = { ...updatedAssignments[activeBand], [student]: workshopName };
        const erstesBandAssignment = updatedAssignments.erstesBand?.[student];
        const zweitesBandAssignment = updatedAssignments.zweitesBand?.[student];
        
        // Check if rule is already fulfilled
        let isFulfilled = false;
        
        if (requiredFolgekurs.band !== null) {
          // sameBand is required - check only the same band
          if (requiredFolgekurs.band === 'erstesBand' && erstesBandAssignment === requiredFolgekurs.course) {
            isFulfilled = true;
          } else if (requiredFolgekurs.band === 'zweitesBand' && zweitesBandAssignment === requiredFolgekurs.course) {
            isFulfilled = true;
          }
          
          // Check if we're in the required band
          if (requiredFolgekurs.band === activeBand) {
            // This is the band where the rule applies
            if (!isFulfilled && requiredFolgekurs.course !== workshopName) {
              setPersistentViolations(prev => ({
                ...prev,
                [workshopName]: {
                  ...(prev[workshopName] || {}),
                  [student]: `Folgekurs-Regel: Schüler muss ${requiredFolgekurs.course} belegen (hat im vorherigen Trimester ${getPreviousTrimesterKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester)} einen Kurs belegt, der diese Regel auslöst).`
                }
              }));
            } else if (requiredFolgekurs.course === workshopName) {
              // Clear violation for this student if assignment is now valid
              setPersistentViolations(prev => {
                const updated = { ...prev };
                if (updated[workshopName]) {
                  const copy = { ...updated[workshopName] };
                  delete copy[student];
                  if (Object.keys(copy).length === 0) {
                    delete updated[workshopName];
                  } else {
                    updated[workshopName] = copy;
                  }
                }
                return updated;
              });
            }
          } else {
            // This is NOT the required band
            // If student is trying to assign the required course here, that's wrong
            if (workshopName === requiredFolgekurs.course) {
              setPersistentViolations(prev => ({
                ...prev,
                [workshopName]: {
                  ...(prev[workshopName] || {}),
                  [student]: `Folgekurs-Regel: ${requiredFolgekurs.course} muss im ${requiredFolgekurs.band === 'erstesBand' ? 'Ersten' : 'Zweiten'} Band belegt werden (gleiches Band wie im vorherigen Trimester erforderlich).`
                }
              }));
            }
          }
        } else {
          // sameBand is not required - check both bands
          if (erstesBandAssignment === requiredFolgekurs.course || zweitesBandAssignment === requiredFolgekurs.course) {
            isFulfilled = true;
          }
          
          // Only show warning if rule is not fulfilled and student is trying to assign something else
          if (!isFulfilled && requiredFolgekurs.course !== workshopName) {
            setPersistentViolations(prev => ({
              ...prev,
              [workshopName]: {
                ...(prev[workshopName] || {}),
                  [student]: `Folgekurs-Regel: Schüler muss ${requiredFolgekurs.course} belegen (hat im vorherigen Trimester ${getPreviousTrimesterKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester)} einen Kurs belegt, der diese Regel auslöst).`
              }
            }));
          } else if (requiredFolgekurs.course === workshopName) {
            // Clear violation for this student if assignment is now valid
            setPersistentViolations(prev => {
              const updated = { ...prev };
              if (updated[workshopName]) {
                const copy = { ...updated[workshopName] };
                delete copy[student];
                if (Object.keys(copy).length === 0) {
                  delete updated[workshopName];
                } else {
                  updated[workshopName] = copy;
                }
              }
              return updated;
            });
          }
        }
        
        if (isFulfilled) {
          // Rule is fulfilled, clear any violations
          setPersistentViolations(prev => {
            const updated = { ...prev };
            if (updated[workshopName]) {
              const copy = { ...updated[workshopName] };
              delete copy[student];
              if (Object.keys(copy).length === 0) {
                delete updated[workshopName];
              } else {
                updated[workshopName] = copy;
              }
            }
            return updated;
          });
        }
      } else {
        // Clear violation for this student if assignment is now valid
        setPersistentViolations(prev => {
          const updated = { ...prev };
          if (updated[workshopName]) {
            const copy = { ...updated[workshopName] };
            delete copy[student];
            if (Object.keys(copy).length === 0) {
              delete updated[workshopName];
            } else {
              updated[workshopName] = copy;
            }
          }
          return updated;
        });
      }
    }
    
    // Also show temporary violation message
    if (!check.ok) {
      setDropViolations(prev => ({ ...prev, [workshopName]: check.reason }));
      setTimeout(() => setDropViolations(prev => {
        const copy = { ...prev };
        delete copy[workshopName];
        return copy;
      }), 5000);
    }
    
    setDragHover({ workshop: null, invalid: false, message: null });
    
    // Update state and auto-save the assignment in the background
    setDragAssignments(prev => {
      const updatedAssignments = {
        ...prev,
        [activeBand]: { ...prev[activeBand], [student]: workshopName }
      };
      
      // Auto-save after state update
      setTimeout(() => {
        const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
        const payload = load(LS_KEYS.assignments, {});
        payload[key] = { 
          assignments: updatedAssignments, 
          timestamp: new Date().toISOString(),
          bands: activeBandIds
        };
        save(LS_KEYS.assignments, payload);
        setConfirmedAssignments(payload);
        
        exportAssignment(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, updatedAssignments, activeBandIds);
      }, 100);
      
      // Return updated state
      return updatedAssignments;
    });
  }


  // Workshops tab functions
  function updateWorkshopCapacity(name, cap) {
    setWorkshops(prev => {
      const current = prev[name] || { capacity: 0, availableBands: ['erstesBand', 'zweitesBand'] };
      return {
        ...prev,
        [name]: {
          ...current,
          capacity: Number(cap)
        }
      };
    });
  }
  
  function updateWorkshopAvailableBands(name, bands) {
    setWorkshops(prev => {
      const current = prev[name] || { capacity: 0, availableBands: ['erstesBand', 'zweitesBand'] };
      return {
        ...prev,
        [name]: {
          ...current,
          availableBands: bands
        }
      };
    });
  }
  
  const [activeWorkshopEditor, setActiveWorkshopEditor] = useState(null);

  function addWorkshop(name, cap) {
    if (!name) return;
    setWorkshops(prev => ({
      ...prev,
      [name]: {
        capacity: Number(cap || 0),
        availableBands: [...ALL_BAND_IDS]
      }
    }));
    setActiveWorkshopEditor({ type: 'active', name });
  }

  function duplicateWorkshop(sourceName) {
    const source = workshops[sourceName];
    if (!source) return null;
    const taken = new Set([...Object.keys(workshops), ...Object.keys(archivedWorkshops)]);
    let copyName = `${sourceName} (Kopie)`;
    let suffix = 2;
    while (taken.has(copyName)) {
      copyName = `${sourceName} (Kopie ${suffix})`;
      suffix += 1;
    }
    const capacity = getWorkshopCapacity(source, sourceName);
    const availableBands = [...getWorkshopAvailableBands(source, sourceName)];
    setWorkshops(prev => ({
      ...prev,
      [copyName]: { capacity, availableBands },
    }));
    if (workshopColors[sourceName]) {
      setWorkshopColors(prev => ({ ...prev, [copyName]: workshopColors[sourceName] }));
    }
    if (workshopTeachers[sourceName]) {
      setWorkshopTeachers(prev => ({ ...prev, [copyName]: workshopTeachers[sourceName] }));
    }
    if (workshopRooms[sourceName]) {
      setWorkshopRooms(prev => ({ ...prev, [copyName]: workshopRooms[sourceName] }));
    }
    if (prereqs[sourceName]?.length) {
      setPrereqs(prev => ({ ...prev, [copyName]: [...prereqs[sourceName]] }));
    }
    if (cannotBeParallel[sourceName]?.length) {
      setCannotBeParallel(prev => ({ ...prev, [copyName]: [...cannotBeParallel[sourceName]] }));
    }
    if (allowSelfParallel[sourceName]) {
      setAllowSelfParallel(prev => ({ ...prev, [copyName]: true }));
    }
    setActiveWorkshopEditor({ type: 'active', name: copyName });
    return copyName;
  }

  // Check if a workshop has been taken by any student
  function hasWorkshopBeenTaken(workshopName) {
    for (const [, payload] of Object.entries(confirmedAssignments)) {
      if (payload.assignments) {
        const bandIds = getPayloadBandIds(payload);
        for (const bandId of bandIds) {
          if (Object.values(payload.assignments[bandId] || {}).includes(workshopName)) {
            return true;
          }
        }
        if (isLegacySingleBandAssignments(payload.assignments)) {
          if (Object.values(payload.assignments).includes(workshopName)) {
            return true;
          }
        }
      }
    }
    for (const student in prevAssignments) {
      const prev = prevAssignments[student];
      if (Array.isArray(prev) && prev.includes(workshopName)) {
        return true;
      } else if (prev === workshopName) {
        return true;
      }
    }
    for (const bandId of ALL_BAND_IDS) {
      if (Object.values(dragAssignments[bandId] || {}).includes(workshopName)) {
        return true;
      }
    }
    return false;
  }

  function deleteWorkshop(name) {
    // Check if workshop has been taken by students
    if (hasWorkshopBeenTaken(name)) {
      // Archive instead of delete
      const ok = window.confirm(`Werkstatt "${name}" wurde bereits von Schülern belegt. Sie wird archiviert statt gelöscht. Fortfahren?`);
      if (!ok) return;
      
      // Move to archived - save all workshop information
      const workshopData = workshops[name];
      const capacity = getWorkshopCapacity(workshopData, name);
      const availableBands = getWorkshopAvailableBands(workshopData, name);
      setArchivedWorkshops(prev => ({
        ...prev,
        [name]: {
          capacity: capacity,
          availableBands: availableBands,
          archivedAt: new Date().toISOString()
        }
      }));
      
      // Remove from active workshops
      const copy = { ...workshops };
      delete copy[name];
      setWorkshops(copy);
      setActiveWorkshopEditor({ type: 'archived', name });
      
      // Keep color, teacher, and room data (they stay with archived workshop)
    } else {
      // No students have taken it, can delete permanently
      const ok = window.confirm(`Werkstatt "${name}" wirklich löschen?`);
      if (!ok) return;
      
      const copy = { ...workshops };
      delete copy[name];
      setWorkshops(copy);
      
      // Also delete associated color, teacher, and room data
      setWorkshopColors(prev => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      setWorkshopTeachers(prev => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      setWorkshopRooms(prev => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      setActiveWorkshopEditor(prev =>
        prev?.type === 'active' && prev.name === name ? null : prev
      );
    }
  }

  function reactivateWorkshop(name) {
    const archived = archivedWorkshops[name];
    if (!archived) return;
    
    // Move back to active workshops - restore full workshop structure
    setWorkshops(prev => ({
      ...prev,
      [name]: {
        capacity: archived.capacity || 0,
        availableBands: archived.availableBands || ['erstesBand', 'zweitesBand']
      }
    }));
    
    // Remove from archived
    setArchivedWorkshops(prev => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    setActiveWorkshopEditor({ type: 'active', name });
  }

  function permanentlyDeleteArchivedWorkshop(name) {
    const warning = `Werkstatt "${name}" wirklich endgültig löschen?\n\nWARNUNG: Dies wird die Werkstatt auch aus allen Schüler-Historien entfernen!`;
    const ok = window.confirm(warning);
    if (!ok) return;
    
    // Remove from archived
    setArchivedWorkshops(prev => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    
    // Remove from all student records
    // Update confirmedAssignments - remove this workshop from all assignments
    setConfirmedAssignments(prev => {
      const updated = { ...prev };
      Object.entries(updated).forEach(([, payload]) => {
        if (payload.assignments) {
          // Update both bands
          if (payload.assignments.erstesBand) {
            const updatedErstes = { ...payload.assignments.erstesBand };
            Object.keys(updatedErstes).forEach(student => {
              if (updatedErstes[student] === name) {
                updatedErstes[student] = 'Nicht Zugeordnet';
              }
            });
            payload.assignments.erstesBand = updatedErstes;
          }
          if (payload.assignments.zweitesBand) {
            const updatedZweites = { ...payload.assignments.zweitesBand };
            Object.keys(updatedZweites).forEach(student => {
              if (updatedZweites[student] === name) {
                updatedZweites[student] = 'Nicht Zugeordnet';
              }
            });
            payload.assignments.zweitesBand = updatedZweites;
          }
        }
      });
      return updated;
    });
    
    // Remove from prevAssignments
    setPrevAssignments(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(student => {
        if (Array.isArray(updated[student])) {
          updated[student] = updated[student].filter(w => w !== name);
        } else if (updated[student] === name) {
          delete updated[student];
        }
      });
      return updated;
    });
    
    // Remove from current dragAssignments
    setDragAssignments(prev => {
      const updated = { ...prev };
      if (updated.erstesBand) {
        const updatedErstes = { ...updated.erstesBand };
        Object.keys(updatedErstes).forEach(student => {
          if (updatedErstes[student] === name) {
            updatedErstes[student] = 'Nicht Zugeordnet';
          }
        });
        updated.erstesBand = updatedErstes;
      }
      if (updated.zweitesBand) {
        const updatedZweites = { ...updated.zweitesBand };
        Object.keys(updatedZweites).forEach(student => {
          if (updatedZweites[student] === name) {
            updatedZweites[student] = 'Nicht Zugeordnet';
          }
        });
        updated.zweitesBand = updatedZweites;
      }
      return updated;
    });
    
    // Delete associated color, teacher, and room data
    setWorkshopColors(prev => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    setWorkshopTeachers(prev => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    setWorkshopRooms(prev => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    setActiveWorkshopEditor(prev =>
      prev?.type === 'archived' && prev.name === name ? null : prev
    );
  }
  function updateWorkshopColor(name, color) {
    setWorkshopColors(prev => ({ ...prev, [name]: color }));
  }
  function updateWorkshopTeacher(name, teacher) {
    console.log('🔄 updateWorkshopTeacher called:', name, teacher);
    setWorkshopTeachers(prev => {
      const updated = { ...prev, [name]: teacher || '' };
      console.log('📝 Updated workshopTeachers state:', updated);
      console.log('📝 Previous state was:', prev);
      return updated;
    });
  }
  function updateWorkshopRoom(name, room) {
    console.log('🔄 updateWorkshopRoom called:', name, room);
    setWorkshopRooms(prev => {
      const updated = { ...prev, [name]: room || '' };
      console.log('📝 Updated workshopRooms state:', updated);
      console.log('📝 Previous state was:', prev);
      return updated;
    });
  }

  const [workshopRenameDialog, setWorkshopRenameDialog] = useState(null);

  function renameKeyInRecord(record, oldName, newName) {
    if (!record || !(oldName in record)) return record;
    const next = { ...record };
    next[newName] = next[oldName];
    delete next[oldName];
    return next;
  }

  function replaceWorkshopInBandAssignments(assignments, oldName, newName) {
    if (!assignments || typeof assignments !== 'object') return assignments;
    if (isLegacySingleBandAssignments(assignments)) {
      const next = { ...assignments };
      Object.keys(next).forEach(student => {
        if (next[student] === oldName) next[student] = newName;
      });
      return next;
    }
    const next = { ...assignments };
    ALL_BAND_IDS.forEach(bandId => {
      if (!next[bandId] || typeof next[bandId] !== 'object') return;
      const band = { ...next[bandId] };
      Object.keys(band).forEach(student => {
        if (band[student] === oldName) band[student] = newName;
      });
      next[bandId] = band;
    });
    return next;
  }

  function renameWorkshopInStoredChoices(oldName, newName) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('wv_choices_')) continue;
      const data = load(key, null);
      if (!data) continue;
      const updated = normalizeBandDataObject(data);
      let changed = false;
      ALL_BAND_IDS.forEach(bandId => {
        const band = updated[bandId];
        if (!band) return;
        Object.keys(band).forEach(student => {
          const ch = band[student];
          if (!Array.isArray(ch)) return;
          const mapped = ch.map(c => (c === oldName ? newName : c));
          if (mapped.some((c, idx) => c !== ch[idx])) {
            band[student] = mapped;
            changed = true;
          }
        });
      });
      if (changed) save(key, updated, false);
    }
  }

  function requestRenameWorkshop(oldName, newNameRaw) {
    const newName = String(newNameRaw || '').trim();
    if (!newName || newName === oldName) return;
    const taken = new Set([...Object.keys(workshops), ...Object.keys(archivedWorkshops)]);
    if (taken.has(newName)) {
      window.alert(`Der Name „${newName}“ ist bereits einer anderen Werkstatt zugeordnet. Bitte wählen Sie einen anderen Namen.`);
      return;
    }
    if (!workshops[oldName] && !archivedWorkshops[oldName]) return;
    setWorkshopRenameDialog({ oldName, newName });
  }

  function confirmRenameWorkshop() {
    if (!workshopRenameDialog) return;
    const { oldName, newName } = workshopRenameDialog;

    setWorkshops(prev => renameKeyInRecord(prev, oldName, newName));
    setArchivedWorkshops(prev => renameKeyInRecord(prev, oldName, newName));
    setWorkshopColors(prev => renameKeyInRecord(prev, oldName, newName));
    setWorkshopTeachers(prev => renameKeyInRecord(prev, oldName, newName));
    setWorkshopRooms(prev => renameKeyInRecord(prev, oldName, newName));

    setPrereqs(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, list]) => {
        const key = k === oldName ? newName : k;
        next[key] = (list || []).map(w => (w === oldName ? newName : w));
      });
      return next;
    });

    setCannotBeParallel(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, list]) => {
        const key = k === oldName ? newName : k;
        next[key] = (list || []).map(w => (w === oldName ? newName : w));
      });
      return next;
    });

    setAllowSelfParallel(prev => {
      if (!prev[oldName]) return prev;
      const next = { ...prev };
      delete next[oldName];
      next[newName] = true;
      return next;
    });

    setRules(prev =>
      prev.map(r => {
        const next = { ...r };
        if (Array.isArray(next.options)) {
          next.options = next.options.map(o => (o === oldName ? newName : o));
        }
        if (next.fromCourse === oldName) next.fromCourse = newName;
        if (next.toCourse === oldName) next.toCourse = newName;
        return next;
      })
    );

    setConfirmedAssignments(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(slotKey => {
        const payload = updated[slotKey];
        if (!payload?.assignments) return;
        updated[slotKey] = {
          ...payload,
          assignments: replaceWorkshopInBandAssignments(payload.assignments, oldName, newName),
        };
      });
      return updated;
    });

    setPrevAssignments(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(student => {
        const val = updated[student];
        if (Array.isArray(val)) {
          updated[student] = val.map(w => (w === oldName ? newName : w));
        } else if (val === oldName) {
          updated[student] = newName;
        }
      });
      return updated;
    });

    setDragAssignments(prev => replaceWorkshopInBandAssignments(prev, oldName, newName));

    setUploadedChoices(prev => {
      const updated = normalizeBandDataObject(prev);
      ALL_BAND_IDS.forEach(bandId => {
        Object.keys(updated[bandId] || {}).forEach(student => {
          const ch = updated[bandId][student];
          if (Array.isArray(ch)) {
            updated[bandId][student] = ch.map(c => (c === oldName ? newName : c));
          }
        });
      });
      return updated;
    });

    setTrimesterPlans(prev => {
      const out = {};
      Object.entries(prev).forEach(([key, plan]) => {
        const courses = { ...(plan.courses || {}) };
        if (Object.prototype.hasOwnProperty.call(courses, oldName)) {
          courses[newName] = courses[oldName];
          delete courses[oldName];
        }
        out[key] = { ...plan, courses };
      });
      return out;
    });

    renameWorkshopInStoredChoices(oldName, newName);

    setActiveWorkshopEditor(prev => {
      if (!prev || prev === 'new') return prev;
      if (prev.name === oldName) return { ...prev, name: newName };
      return prev;
    });
    if (editingWorkshop === oldName) setEditingWorkshop(newName);

    setWorkshopRenameDialog(null);
  }

  // Rules tab: manage rules - students must have taken ALL listed courses at some point
  // Rule types:
  // - "belegung": all listed courses at least once
  // - "mindestbelegung": at least minCount distinct courses from options
  // - "folgekurs": sequential course requirement
  // - "freitext": manual checklist with free-text description
  const [activeRuleEditor, setActiveRuleEditor] = useState(null);

  function addRule(rule) {
    const id = Date.now();
    setRules(prev => [...prev, { ...rule, id }]);
    return id;
  }
  function updateRule(id, updates) {
    setRules(prev => prev.map(r => {
      if (r.id !== id) return r;
      const type = r.type || 'belegung';
      return { ...r, ...updates, id, type };
    }));
  }
  function deleteRule(id) {
    setRules(prev => prev.filter(r => r.id !== id));
    setActiveRuleEditor(prev => (prev === id ? null : prev));
  }

  function duplicateRule(sourceId) {
    const source = rules.find(r => r.id === sourceId);
    if (!source) return null;
    const baseName = source.name || 'Regel';
    let copyName = `${baseName} (Kopie)`;
    const taken = new Set(rules.map(r => r.name));
    let suffix = 2;
    while (taken.has(copyName)) {
      copyName = `${baseName} (Kopie ${suffix})`;
      suffix += 1;
    }
    const { id: _omit, ...rest } = source;
    const newId = addRule({
      ...rest,
      name: copyName,
      options: Array.isArray(rest.options) ? [...rest.options] : rest.options,
      klassenStufenRange: rest.klassenStufenRange
        ? { ...rest.klassenStufenRange }
        : rest.klassenStufenRange,
    });
    setActiveRuleEditor(newId);
    return newId;
  }

  // Student trimester management
  // Update student class manually from Student Tab
  function updateStudentClass(student, newClass) {
    setStudentClasses(prev => {
      const updated = { ...prev };
      if (newClass !== undefined && newClass !== null && newClass !== '') {
        updated[student] = newClass;
      } else {
        delete updated[student];
      }
      return updated;
    });
  }

  function updateStudentEnrollmentYear(student, yearValue) {
    setStudentEnrollmentYears(prev => {
      const updated = { ...prev };
      const year = parseOptionalRuleYear(yearValue);
      if (year != null) {
        updated[student] = year;
      } else {
        delete updated[student];
      }
      return updated;
    });
  }

  function addClassToRegistry(className, assignToStudent = null) {
    const trimmed = String(className || '').trim();
    if (!trimmed) return false;
    setClassRegistry(prev => [...new Set([...prev, trimmed])].sort());
    const stufe = parseKlassenStufeFromClass(trimmed);
    if (stufe != null) {
      setKlassenStufenPool(prev => [...new Set([...prev, stufe])].sort((a, b) => a - b));
    }
    if (assignToStudent) {
      updateStudentClass(assignToStudent, trimmed);
    }
    return true;
  }

  function addKlassenStufeToPool() {
    setKlassenStufenPool(prev => {
      const next = prev.length ? Math.max(...prev) + 1 : 5;
      if (prev.includes(next)) return prev;
      return [...prev, next].sort((a, b) => a - b);
    });
  }

  function formatUploadTrimesterLabel(trimesterKey) {
    const parsed = parseSchoolYearKey(trimesterKey);
    if (!parsed) return trimesterKey;
    return formatYearTrimester(parsed.schoolYearStart, parsed.schoolYearEnd, parsed.trimester);
  }

  function getStudentClassDescription(student) {
    const current = studentClasses[student];
    const uploadInfo = studentClassUploadInfo[student];
    const uploads = Array.isArray(uploadInfo?.uploads) ? uploadInfo.uploads : [];
    if (uploads.length) {
      const latest = [...uploads].sort((a, b) => String(a.trimesterKey).localeCompare(String(b.trimesterKey))).pop();
      const sameSlot = uploads.filter(entry => entry.trimesterKey === latest.trimesterKey && entry.className === latest.className);
      const bandLabels = [...new Set(sameSlot.map(entry => getBandShortLabel(entry.bandId)).filter(Boolean))];
      const trimesterLabel = formatUploadTrimesterLabel(latest.trimesterKey);
      const bandText = bandLabels.length ? ` (${bandLabels.join(', ')})` : '';
      let text = `Laut Wahl-Upload für ${trimesterLabel}${bandText} ist ${student} in Klasse ${latest.className}.`;
      if (current && current !== latest.className) {
        text += ` Aktuell manuell zugeordnet: Klasse ${current}.`;
      }
      return text;
    }
    if (uploadInfo?.className) {
      const trimesterLabel = formatUploadTrimesterLabel(uploadInfo.trimesterKey);
      let text = `Laut Wahl-Upload für ${trimesterLabel} ist ${student} in Klasse ${uploadInfo.className}.`;
      if (current && current !== uploadInfo.className) {
        text += ` Aktuell manuell zugeordnet: Klasse ${current}.`;
      }
      return text;
    }
    if (current) {
      return `${student} ist in Klasse ${current}. (Keine Zuordnung aus einem Wahl-Upload gespeichert.)`;
    }
    return `${student} hat noch keine Klasse.`;
  }

  // Update student comment
  function updateStudentComment(student, comment) {
    setStudentComments(prev => ({ ...prev, [student]: comment }));
  }

  // NEW: toggle personal assistant flag for a student
  function toggleStudentAssistant(student) {
    setStudentAssistants(prev => ({ ...prev, [student]: !prev[student] }));
  }

  function toggleManualRuleCheck(student, ruleId) {
    setManualRuleChecks(prev => {
      const studentChecks = { ...(prev[student] || {}) };
      studentChecks[ruleId] = !studentChecks[ruleId];
      return { ...prev, [student]: studentChecks };
    });
  }

  // Calculate current workshop assignments for the active Band
  function getCurrentWorkshopCounts() {
    const counts = {};
    Object.keys(workshops).forEach(workshop => {
      counts[workshop] = 0;
    });
    
    // Count from dragAssignments for the active Band (current editing state)
    const currentBandAssignments = dragAssignments[activeBand] || {};
    Object.values(currentBandAssignments).forEach(assignment => {
      if (assignment && assignment !== 'Nicht Zugeordnen' && counts.hasOwnProperty(assignment)) {
        counts[assignment]++;
      }
    });
    
    return counts;
  }

  // Workshop prerequisites management
  const [editingWorkshop, setEditingWorkshop] = useState(null);
  const [tempPrereqs, setTempPrereqs] = useState([]);
  const [showPrereqDialog, setShowPrereqDialog] = useState(false);
  const [tempCannotBeParallel, setTempCannotBeParallel] = useState([]);
  const [showCannotBeParallelDialog, setShowCannotBeParallelDialog] = useState(false);

  function handleWorkshopClick(name) {
    setEditingWorkshop(name);
    setTempPrereqs(prereqs[name] || []);
    setShowPrereqDialog(true);
  }

  function toggleTempPrereq(course) {
    if (tempPrereqs.includes(course)) {
      setTempPrereqs(tempPrereqs.filter((c) => c !== course));
    } else {
      setTempPrereqs([...tempPrereqs, course]);
    }
  }

  function saveWorkshopPrereqs() {
    setPrereqs({ ...prereqs, [editingWorkshop]: tempPrereqs });
    setShowPrereqDialog(false);
  }

  function handleCannotBeParallelClick(name) {
    setEditingWorkshop(name);
    setTempCannotBeParallel(cannotBeParallel[name] || []);
    setShowCannotBeParallelDialog(true);
  }

  function toggleTempCannotBeParallel(course) {
    if (tempCannotBeParallel.includes(course)) {
      setTempCannotBeParallel(tempCannotBeParallel.filter((c) => c !== course));
    } else {
      setTempCannotBeParallel([...tempCannotBeParallel, course]);
    }
  }

  function saveWorkshopCannotBeParallel() {
    setCannotBeParallel({ ...cannotBeParallel, [editingWorkshop]: tempCannotBeParallel });
    setShowCannotBeParallelDialog(false);
  }

  function checkViolationsForStudent(s, choices) {
    const issues = [];
    // if they chose previous assignment -> violation (we removed it in auto but for record)
    const last = prevAssignments[s];
    if (last && (choices || []).includes(last)) {
      issues.push(`Wahl verletzt Regel: ${last} war bereits letztes Jahr zugeordnet.`);
    }
    // if they picked same option twice
    if (choices && choices.length > 1 && choices.every(c => c === choices[0])) {
      issues.push("Wahl enthält mehrfach dieselbe Werkstatt.");
    }
    if (choices && choices.length > activeTrimesterWahlCount) {
      issues.push(`Mehr als ${activeTrimesterWahlCount} Wahlen laut Trimester-Plan.`);
    }
    return issues;
  }

  // Student management functions
  function addNewStudent() {
    if (!newStudentName.trim()) {
      alert('Bitte geben Sie einen Namen ein.');
      return;
    }
    if (students.includes(newStudentName.trim())) {
      alert('Dieser Schüler existiert bereits.');
      return;
    }
    setStudents([...students, newStudentName.trim()]);
    if (newStudentClass.trim()) {
      setStudentClasses(prev => ({ ...prev, [newStudentName.trim()]: newStudentClass.trim() }));
    }
    setStudentPriorityScores(prev => ({ ...prev, [newStudentName.trim()]: 5 }));
    setNewStudentName("");
    setNewStudentClass("");
  }

  function deleteStudent(studentName) {
    if (!window.confirm(`Möchten Sie "${studentName}" wirklich löschen?`)) return;
    setStudents(students.filter(s => s !== studentName));
    setStudentClasses(prev => {
      const copy = { ...prev };
      delete copy[studentName];
      return copy;
    });
    setStudentPriorityScores(prev => {
      const copy = { ...prev };
      delete copy[studentName];
      return copy;
    });
    setStudentAssistants(prev => {
      const copy = { ...prev };
      delete copy[studentName];
      return copy;
    });
    setStudentTrimesters(prev => {
      const copy = { ...prev };
      delete copy[studentName];
      return copy;
    });
    setStudentComments(prev => {
      const copy = { ...prev };
      delete copy[studentName];
      return copy;
    });
    if (selectedStudent === studentName) {
      setSelectedStudent(null);
    }
  }

  function deleteSelectedStudents() {
    if (selectedStudents.size === 0) {
      alert('Bitte wählen Sie mindestens einen Schüler aus.');
      return;
    }
    if (!window.confirm(`Möchten Sie ${selectedStudents.size} Schüler wirklich löschen?`)) return;
    const toDelete = Array.from(selectedStudents);
    setStudents(students.filter(s => !toDelete.includes(s)));
    setStudentClasses(prev => {
      const copy = { ...prev };
      toDelete.forEach(s => delete copy[s]);
      return copy;
    });
    setStudentPriorityScores(prev => {
      const copy = { ...prev };
      toDelete.forEach(s => delete copy[s]);
      return copy;
    });
    setStudentAssistants(prev => {
      const copy = { ...prev };
      toDelete.forEach(s => delete copy[s]);
      return copy;
    });
    setStudentTrimesters(prev => {
      const copy = { ...prev };
      toDelete.forEach(s => delete copy[s]);
      return copy;
    });
    setStudentComments(prev => {
      const copy = { ...prev };
      toDelete.forEach(s => delete copy[s]);
      return copy;
    });
    setSelectedStudents(new Set());
    if (selectedStudent && toDelete.includes(selectedStudent)) {
      setSelectedStudent(null);
    }
  }

  function toggleStudentSelection(studentName) {
    setSelectedStudents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(studentName)) {
        newSet.delete(studentName);
      } else {
        newSet.add(studentName);
      }
      return newSet;
    });
  }

  // Helper to get choices for a specific Band
  function getChoicesForBand(band) {
    return uploadedChoices[band] || {};
  }

  // Helper to get assignments for a specific Band
  // Returns assignments for all students - unassigned students will have undefined/null assignment
  function getAssignmentsForBand(band) {
    const assignments = dragAssignments[band] || {};
    // Ensure all students are included, even if they don't have an assignment yet
    const allAssignments = {};
    students.forEach(student => {
      allAssignments[student] = assignments[student];
    });
    return allAssignments;
  }

  // Check for students assigned to same workshop in both bands
  function hasNoVotesForBand(student, band) {
    const choices = getChoicesForBand(band)[student];
    return !Array.isArray(choices) || choices.length === 0;
  }

  function studentExpectedOnBand(student, bandId) {
    return isStudentExpectedToVoteOnBand(
      student,
      activeTrimesterPlan,
      bandId,
      studentEnrollmentYears,
      studentClasses
    );
  }

  function isOpenAssignment(assignment) {
    return !assignment || isNotAssigned(assignment);
  }

  function unassignedStudentsForBand(bandId) {
    const extras = extraUnassignedByBand[bandId] || [];
    return students.filter(student => {
      const assignment = dragAssignments[bandId]?.[student];
      if (!isOpenAssignment(assignment)) return false;
      return studentExpectedOnBand(student, bandId) || extras.includes(student);
    });
  }

  function addStudentToUnassigned(student) {
    setExtraUnassignedByBand(prev => {
      const list = prev[activeBand] || [];
      if (list.includes(student)) return prev;
      return { ...prev, [activeBand]: [...list, student] };
    });
    setAddUnassignedQuery('');
  }

  function workshopsConflict(left, right) {
    if (!left || !right || isNotAssigned(left) || isNotAssigned(right)) return false;
    const leftBlocked = cannotBeParallel[left] || [];
    const rightBlocked = cannotBeParallel[right] || [];
    return leftBlocked.includes(right) || rightBlocked.includes(left);
  }

  function bandWarningGroups() {
    return activeBandIds.map(bandId => {
      const choiceCount = Object.keys(getChoicesForBand(bandId)).length;
      const missing = choiceCount > 0
        ? students.filter(student => studentExpectedOnBand(student, bandId) && hasNoVotesForBand(student, bandId))
        : [];
      const selfParallel = [];
      const ruleParallel = [];
      const sameFirst = [];
      students.forEach(student => {
        const here = dragAssignments[bandId]?.[student];
        const hereChoice = getChoicesForBand(bandId)[student]?.[0];
        activeBandIds.forEach(otherBandId => {
          if (otherBandId === bandId) return;
          const there = dragAssignments[otherBandId]?.[student];
          if (here && there && !isNotAssigned(here) && here === there && !courseAllowsSelfParallel(here, allowSelfParallel)) {
            selfParallel.push({ student, workshop: here, otherBandId });
          } else if (here && there && !isNotAssigned(here) && !isNotAssigned(there) && workshopsConflict(here, there)) {
            ruleParallel.push({ student, workshop: here, otherWorkshop: there, otherBandId });
          }
          const otherChoice = getChoicesForBand(otherBandId)[student]?.[0];
          if (
            hereChoice &&
            otherChoice &&
            hereChoice === otherChoice &&
            !courseAllowsSelfParallel(hereChoice, allowSelfParallel)
          ) {
            sameFirst.push({ student, workshop: hereChoice, otherBandId });
          }
        });
      });
      return { bandId, missing, selfParallel, ruleParallel, sameFirst };
    });
  }

  // Toggle warning checkbox
  function toggleWarningCheck(warningKey) {
    setCheckedWarnings(prev => ({
      ...prev,
      [warningKey]: !prev[warningKey]
    }));
  }

  // Build per-student history view from confirmedAssignments
  function buildHistoryForStudent(student) {
    const history = [];
    Object.entries(confirmedAssignments).forEach(([slotKey, payload]) => {
      if (isMultiBandPayload(payload)) {
        const bandIds = getPayloadBandIds(payload);
        const bandAssignments = bandIds.map(bandId =>
          payload.assignments[bandId]?.[student] || 'Nicht Zugeordnet'
        );
        history.push({
          slotKey,
          assigned: bandAssignments.join(' / '),
          timestamp: payload.timestamp,
          bandIds,
          bandAssignments,
        });
      } else {
        const assigned = payload.assignments?.[student] || 'Nicht Zugeordnet';
        history.push({ slotKey, assigned, timestamp: payload.timestamp });
      }
    });
    history.sort((a, b) => (a.slotKey < b.slotKey ? 1 : -1));
    return history;
  }

  const bandSwitcher = (
    <div className="flex flex-wrap gap-2">
      {activeBandIds.map(bandId => {
        const choiceCount = Object.keys(getChoicesForBand(bandId)).length;
        const assignedCount = Object.values(dragAssignments[bandId] || {}).filter(a => !isNotAssigned(a)).length;
        const subtitle = activeTrimesterPlan?.bandSubtitles?.[bandId]?.trim();
        return (
          <button
            key={bandId}
            type="button"
            onClick={() => setActiveBand(bandId)}
            className={`px-4 py-2.5 rounded-xl font-semibold transition-all text-sm text-left ${
              activeBand === bandId
                ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-300'
                : 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-200'
            }`}
          >
            <span className="block">
              {getBandShortLabel(bandId)}
              {subtitle ? (
                <span className={`font-normal ${activeBand === bandId ? 'text-blue-50' : 'text-gray-600'}`}>
                  {' · '}{subtitle}
                </span>
              ) : null}
            </span>
            <span className={`block text-[11px] font-normal mt-0.5 ${activeBand === bandId ? 'text-blue-100' : 'text-gray-500'}`}>
              {choiceCount > 0 ? `${choiceCount} Wahlen` : 'Kein Upload'}
              {assignedCount > 0 ? ` · ${assignedCount} zugeordnet` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );

  // ----------------------------
  // UI
  // ----------------------------
  return (
    <div className="app-container">
      {/* Unsaved Changes Warning */}
      <header className="app-header">
        <nav className="nav-buttons">
          <button className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
            tab==='students' 
              ? 'bg-teal-700 text-white border-teal-800' 
              : 'bg-white text-slate-700 border-slate-400 hover:border-teal-700 hover:bg-teal-50'
          }`} onClick={()=>setTab('students')}>Schüler</button>
          <button className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
            tab==='wahl' 
              ? 'bg-teal-700 text-white border-teal-800' 
              : 'bg-white text-slate-700 border-slate-400 hover:border-teal-700 hover:bg-teal-50'
          }`} onClick={() => {
            setTab('wahl');
            if (!hasVisitedWahlTab.current) {
              hasVisitedWahlTab.current = true;
              if (definedTrimesterList.length > 0) setShowTrimesterDialog(true);
            }
          }}>Wahl & Zuordnung</button>
          <button className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
            tab==='trimester' 
              ? 'bg-teal-700 text-white border-teal-800' 
              : 'bg-white text-slate-700 border-slate-400 hover:border-teal-700 hover:bg-teal-50'
          }`} onClick={()=>setTab('trimester')}>Trimester</button>
          <button className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
            tab==='reports' 
              ? 'bg-teal-700 text-white border-teal-800' 
              : 'bg-white text-slate-700 border-slate-400 hover:border-teal-700 hover:bg-teal-50'
          }`} onClick={()=>setTab('reports')}>Berichte</button>
          <button className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
            tab==='workshops' 
              ? 'bg-teal-700 text-white border-teal-800' 
              : 'bg-white text-slate-700 border-slate-400 hover:border-teal-700 hover:bg-teal-50'
          }`} onClick={()=>setTab('workshops')}>Werkstätten</button>
          <button className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
            tab==='rules' 
              ? 'bg-teal-700 text-white border-teal-800' 
              : 'bg-white text-slate-700 border-slate-400 hover:border-teal-700 hover:bg-teal-50'
          }`} onClick={()=>setTab('rules')}>Belegungs-Regeln</button>

          <div className="relative ml-auto" ref={dataMenuRef}>
            <input
              ref={importDataInputRef}
              type="file"
              accept=".zip"
              onChange={(e) => {
                handleImportData(e);
                setDataMenuOpen(false);
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setDataMenuOpen(open => !open)}
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors flex items-center gap-2 ${
                dataMenuOpen
                  ? 'bg-teal-700 text-white border-teal-800'
                  : 'bg-white text-slate-700 border-slate-400 hover:border-teal-700 hover:bg-teal-50'
              }`}
              aria-expanded={dataMenuOpen}
              aria-haspopup="menu"
            >
              Daten
              <svg className={`w-4 h-4 transition-transform ${dataMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {dataMenuOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-[100] text-left"
                role="menu"
              >
                <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 mb-1">
                  Backup &amp; Wiederherstellung
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full px-4 py-2.5 text-sm text-gray-800 hover:bg-green-50 flex items-center gap-2"
                  onClick={() => {
                    handleExportAllData();
                    setDataMenuOpen(false);
                  }}
                >
                  <span className="text-green-600">↓</span>
                  Alle Daten als ZIP exportieren
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full px-4 py-2.5 text-sm text-gray-800 hover:bg-blue-50 flex items-center gap-2"
                  onClick={() => importDataInputRef.current?.click()}
                >
                  <span className="text-blue-600">↑</span>
                  ZIP-Backup importieren
                </button>
                <div className="my-2 border-t border-gray-100" />
                <div className="px-4 py-2 text-xs text-gray-600 leading-relaxed">
                  <span className="font-medium text-gray-800">{students.length}</span> Schüler ·{' '}
                  <span className="font-medium text-gray-800">{Object.keys(workshops).length}</span> Werkstätten ·{' '}
                  <span className="font-medium text-gray-800">{Object.keys(confirmedAssignments).length}</span> Trimester gespeichert
                </div>
                <div className="my-2 border-t border-gray-100" />
                <button
                  type="button"
                  role="menuitem"
                  className="w-full px-4 py-2.5 text-sm text-red-700 hover:bg-red-50 flex items-center gap-2"
                  onClick={() => {
                    setDataMenuOpen(false);
                    handleClearAllData();
                  }}
                >
                  Alle Daten löschen…
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>

      {/* Trimester Selection Dialogs - Outside tabs so they always render */}
      {/* Dialog for Wahl Tab */}
      <Dialog open={showTrimesterDialog} onOpenChange={(open) => {
        setShowTrimesterDialog(open);
        if (open) {
          setDialogYearTrimester(yearTrimester);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Trimester auswählen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {definedTrimesterList.length === 0 ? (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
                Es sind noch keine Trimester definiert. Legen Sie zuerst unter <strong>Trimester</strong> ein Trimester an.
                <button
                  type="button"
                  className="block mt-3 text-teal-700 font-semibold underline"
                  onClick={() => { setShowTrimesterDialog(false); setTab('trimester'); }}
                >
                  Zum Trimester-Management
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Definiertes Trimester:</label>
                  <select
                    value={getSchoolYearKey(dialogYearTrimester.schoolYearStart, dialogYearTrimester.schoolYearEnd, dialogYearTrimester.trimester)}
                    onChange={(e) => {
                      const plan = trimesterPlans[e.target.value];
                      if (!plan) return;
                      setDialogYearTrimester({
                        schoolYearStart: plan.schoolYearStart,
                        schoolYearEnd: plan.schoolYearEnd,
                        trimester: plan.trimester,
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    {definedTrimesterList.map(plan => (
                      <option key={plan.key} value={plan.key}>
                        {formatYearTrimester(plan.schoolYearStart, plan.schoolYearEnd, plan.trimester)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTrimesterDialog(false)}
                    className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm rounded-lg"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setYearTrimester(dialogYearTrimester);
                      setShowTrimesterDialog(false);
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                  >
                    Bestätigen
                  </button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Dialog for Reports Tab */}
      <Dialog open={showReportsTrimesterDialog} onOpenChange={(open) => {
        setShowReportsTrimesterDialog(open);
        if (open) {
          setDialogYearTrimester(reportYearTrimester);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Trimester auswählen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Schuljahr:</label>
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  value={dialogYearTrimester.schoolYearStart} 
                  onChange={(e) => {
                    const start = parseInt(e.target.value) || getDefaultSchoolYear().schoolYearStart;
                    setDialogYearTrimester({ schoolYearStart: start, schoolYearEnd: start + 1, trimester: dialogYearTrimester.trimester });
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  min="2020"
                  max="2100"
                />
                <span className="text-gray-500">/</span>
                <div className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-600">
                  {dialogYearTrimester.schoolYearEnd}
                </div>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trimester:</label>
              <select 
                value={dialogYearTrimester.trimester} 
                onChange={(e) => setDialogYearTrimester(prev => ({ ...prev, trimester: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value={1}>1. Trimester</option>
                <option value={2}>2. Trimester</option>
                <option value={3}>3. Trimester</option>
              </select>
            </div>
            
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowReportsTrimesterDialog(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm rounded-lg"
              >
                Abbrechen
              </button>
              <button
                onClick={() => {
                  setReportYearTrimester(dialogYearTrimester);
                  setShowReportsTrimesterDialog(false);
                }}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
              >
                Bestätigen
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {tab === 'students' && (
        <section className="section">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="students-layout">
              <div className="students-sidebar">
                {/* Add New Student */}
                <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-4 mb-4 shadow-sm border border-green-200">
                  <h3 className="text-lg font-semibold mb-3 text-green-900 border-b border-green-300 pb-2">Neuer Schüler</h3>
                  <div className="space-y-2">
                    <input 
                      placeholder="Name" 
                      value={newStudentName} 
                      onChange={(e)=>setNewStudentName(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addNewStudent()}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 text-sm" 
                    />
                    <input 
                      placeholder="Klasse (optional)" 
                      value={newStudentClass} 
                      onChange={(e)=>setNewStudentClass(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addNewStudent()}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 text-sm" 
                    />
                    <button 
                      onClick={addNewStudent}
                      className="w-full px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200"
                    >
                      + Schüler hinzufügen
                    </button>
                  </div>
                </div>

                {/* Search and Filter */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl p-4 mb-4 shadow-sm border border-blue-200">
                  <h3 className="text-lg font-semibold mb-3 text-blue-900 border-b border-blue-300 pb-2">Suche & Filter</h3>
                  <input 
                    placeholder="Suche Schüler" 
                    value={query} 
                    onChange={(e)=>setQuery(e.target.value)} 
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 mb-2" 
                  />
                  <select 
                    value={classFilter} 
                    onChange={(e)=>setClassFilter(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  >
                    <option value="">Alle Klassen</option>
                    {uniqueClasses.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Multi-select Actions */}
                {selectedStudents.size > 0 && (
                  <div className="bg-gradient-to-br from-red-50 to-rose-100 rounded-xl p-4 mb-4 shadow-sm border border-red-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-red-800">
                        {selectedStudents.size} ausgewählt
                      </span>
                      <button 
                        onClick={() => setSelectedStudents(new Set())}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Abbrechen
                      </button>
                    </div>
                    <button 
                      onClick={deleteSelectedStudents}
                      className="w-full px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-red-600 hover:to-red-700 hover:shadow-md transition-all duration-200"
                    >
                      🗑️ Ausgewählte löschen
                    </button>
                  </div>
                )}

                {/* Students List */}
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4 shadow-sm border border-gray-200">
                  <h3 className="text-lg font-semibold mb-3 text-gray-800 border-b border-gray-300 pb-2">
                    Schüler-Liste ({filteredStudents.length})
                  </h3>
                  <div className="students-list max-h-96 overflow-y-auto">
                    {filteredStudents.length === 0 ? (
                      <div className="text-gray-500 italic p-3 text-center text-sm">
                        Keine Schüler gefunden.
                      </div>
                    ) : (
                      filteredStudents.map(s => (
                      <div 
                        key={s} 
                          className={`p-3 rounded-lg mb-2 border-2 transition-colors ${
                          selectedStudent===s
                            ? 'bg-teal-100 text-slate-900 border-teal-800'
                              : selectedStudents.has(s)
                              ? 'bg-amber-50 text-slate-900 border-amber-600'
                            : 'bg-white text-slate-800 border-slate-300 hover:border-teal-700 hover:bg-teal-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-1">
                              <input 
                                type="checkbox"
                                checked={selectedStudents.has(s)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleStudentSelection(s);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <div 
                                className="flex-1 cursor-pointer"
                                onClick={()=>setSelectedStudent(s)}
                              >
                                <div className="font-medium flex items-center justify-between">
                                  <span className="text-slate-900">{s}</span>
                                  {studentClasses[s] ? (
                                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${selectedStudent===s ? 'bg-teal-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
                                      {studentClasses[s]}
                                    </span>
                                  ) : (
                                    <span className={`text-[10px] italic ${selectedStudent===s ? 'text-teal-800' : 'text-slate-400'}`}>
                                      ohne Klasse
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteStudent(s);
                              }}
                              className="ml-2 text-red-500 hover:text-red-700 text-sm px-2 py-1 rounded hover:bg-red-50 transition-all duration-200"
                              title="Schüler löschen"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="students-main">
                <div className="student-details">
                  {!selectedStudent ? (
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-8 text-center shadow-sm border border-gray-200">
                      <div className="text-gray-500 text-lg">Wähle einen Schüler aus, um Details zu sehen.</div>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 shadow-sm border border-green-200 space-y-5">
                      {(() => {
                        const priorityScore = calculatePriorityScoreFromHistory(selectedStudent);
                        const priorityLabel = priorityScore >= 8 ? 'Hoch' : priorityScore >= 5 ? 'Mittel' : 'Niedrig';
                        return (
                          <div className="border-b border-green-300 pb-4">
                            <h2 className="text-2xl font-bold text-green-900 mb-2">{selectedStudent}</h2>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              {studentAssistants[selectedStudent] && (
                                <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-medium border border-blue-200">
                                  Lernbegleitung
                                </span>
                              )}
                              <span
                                className="px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-800 font-medium border border-gray-200"
                                title="Automatisch aus Zuweisungs-Historie berechnet"
                              >
                                Priorität {priorityScore.toFixed(1)}/10 · {priorityLabel}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 space-y-4">
                      <div>
                        <h3 className="text-base font-semibold text-gray-800 mb-3">Klasse</h3>
                        <div className="flex flex-wrap items-center gap-2">
                          {classRegistry.length === 0 && !showAddClassForm && (
                            <span className="text-sm text-gray-500">Noch keine Klassen angelegt.</span>
                          )}
                          {classRegistry.map(cls => {
                            const isActive = studentClasses[selectedStudent] === cls;
                            return (
                              <button
                                key={cls}
                                type="button"
                                onClick={() => updateStudentClass(selectedStudent, cls)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                  isActive
                                    ? 'bg-green-600 text-white border-green-700 shadow-sm'
                                    : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 hover:border-gray-400'
                                }`}
                              >
                                {cls}
                              </button>
                            );
                          })}
                          {!showAddClassForm ? (
                            <button
                              type="button"
                              onClick={() => setShowAddClassForm(true)}
                              className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-dashed border-green-600 text-green-700 hover:bg-green-50"
                            >
                              + Neue Klasse anlegen
                            </button>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                              <input
                                type="text"
                                placeholder="z. B. 5a"
                                value={newRegistryClassName}
                                onChange={e => setNewRegistryClassName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && addClassToRegistry(newRegistryClassName, selectedStudent)) {
                                    setNewRegistryClassName('');
                                    setShowAddClassForm(false);
                                  }
                                  if (e.key === 'Escape') {
                                    setShowAddClassForm(false);
                                    setNewRegistryClassName('');
                                  }
                                }}
                                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm min-w-[8rem]"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (addClassToRegistry(newRegistryClassName, selectedStudent)) {
                                    setNewRegistryClassName('');
                                    setShowAddClassForm(false);
                                  }
                                }}
                                className="px-3 py-1.5 bg-green-600 text-white text-sm font-semibold rounded-lg"
                              >
                                Anlegen & zuweisen
                              </button>
                              <button
                                type="button"
                                onClick={() => { setShowAddClassForm(false); setNewRegistryClassName(''); }}
                                className="px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                              >
                                Abbrechen
                              </button>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 mt-3 leading-relaxed">
                          {getStudentClassDescription(selectedStudent)}
                        </p>
                      </div>
                      <div className="pt-3 border-t border-gray-100">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <label className="text-sm font-medium text-gray-800">Einschulungsjahr</label>
                          <button
                            type="button"
                            onClick={() => setShowEinschulungsjahrInfo(v => !v)}
                            className="text-xs font-semibold px-2 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                            aria-expanded={showEinschulungsjahrInfo}
                          >
                            Info
                          </button>
                        </div>
                        {showEinschulungsjahrInfo && (
                          <div className="text-xs text-blue-950 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2 leading-relaxed space-y-2">
                            <p>
                              Das Einschulungsjahr wird <strong>beim allerersten Auftauchen in einem Wahl-Upload</strong> gesetzt
                              (sobald der Schüler Wahlen und eine Klasse in der Datei hat).
                            </p>
                            <p>
                              Daraus wird der Einschulungsjahrgang berechnet:{' '}
                              <strong>Schuljahresstart minus (Klassenstufe − 5)</strong>.
                              Beispiel: Klasse 7a im Schuljahr 2025/26 → Einschulungsjahr 2023.
                            </p>
                            <p>
                              <strong>Sitzenbleiben:</strong> Bleibt ein Schüler in derselben Klassenstufe hängen, wird{' '}
                              <strong>kein neues</strong> Einschulungsjahr vergeben — der Jahrgang bleibt für Regeln unverändert.
                              Spätere Uploads ändern einen bereits gesetzten Wert nicht (nur manuell hier).
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-gray-500 mb-2">
                          Für Belegungs-Regeln nach Einschulungsjahrgang. Wird sonst automatisch beim ersten Wahl-Upload gesetzt.
                        </p>
                        <select
                          value={studentEnrollmentYears[selectedStudent] ?? ''}
                          onChange={e => updateStudentEnrollmentYear(selectedStudent, e.target.value)}
                          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                        >
                          <option value="">— nicht gesetzt —</option>
                          {getEinschulungsjahrYearOptions().map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                      <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-800 pt-2 border-t border-gray-100">
                        <input
                          type="checkbox"
                          checked={!!studentAssistants[selectedStudent]}
                          onChange={() => toggleStudentAssistant(selectedStudent)}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300"
                        />
                        Benötigt Lernbegleitung (höchste Zuordnungs-Priorität)
                      </label>
                    </div>

                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                      <label className="text-base font-semibold text-gray-800 block mb-2">Notizen</label>
                      <textarea
                        value={studentComments[selectedStudent] || ''}
                        onChange={(e) => updateStudentComment(selectedStudent, e.target.value)}
                        placeholder="Interne Notizen zu diesem Schüler…"
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm resize-y"
                      />
                    </div>

                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                      <h3 className="text-base font-semibold text-gray-800 mb-3">Pflichtkurse & Regeln</h3>
                      <div className="detail-content">
                        {rules.length===0 ? (
                          <div className="text-gray-500 italic p-3 bg-gray-50 rounded-lg">Keine Regeln definiert.</div>
                        ) : (
                          <ul className="space-y-2">
                            {rules.map(r => {
                              const studentHistory = buildHistoryForStudent(selectedStudent);
                              const historyFlat = flattenWorkshopsFromStudentHistory(studentHistory);
                              const ruleType = r.type || 'belegung';
                              const cohortStatus = getStudentCohortRuleStatus(r, selectedStudent, studentEnrollmentYears);
                              if (cohortStatus === 'outside') {
                                return (
                                  <li key={r.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-gray-600">
                                    <span className="text-xs font-medium text-slate-500 block mb-0.5">Nicht betroffen</span>
                                    <span className="font-medium text-gray-700">{r.name}</span>
                                    <p className="text-xs mt-1">{formatRuleScopeLabel(r)} · Einschulungsjahr passt nicht</p>
                                  </li>
                                );
                              }
                              if (cohortStatus === 'missing') {
                                return (
                                  <li key={r.id} className="p-3 rounded-lg bg-slate-50 border border-amber-200 text-gray-600">
                                    <span className="text-xs font-medium text-amber-700 block mb-0.5">Einschulungsjahr fehlt</span>
                                    <span className="font-medium text-gray-700">{r.name}</span>
                                    <p className="text-xs mt-1">{formatRuleScopeLabel(r)} · Bitte Einschulungsjahr setzen</p>
                                  </li>
                                );
                              }
                              const phase = getRuleZeitraumPhase(r, selectedStudent, studentClasses);

                              if (phase === 'upcoming' || phase === 'unknown') {
                                const range = getRuleKlassenStufenRange(r);
                                const stufe = getStudentKlassenStufe(selectedStudent, studentClasses);
                                return (
                                  <li key={r.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-gray-600">
                                    <span className="text-xs font-medium text-slate-500 block mb-0.5">
                                      {phase === 'upcoming' ? 'Noch nicht fällig' : 'Klasse unbekannt'}
                                    </span>
                                    <span className="font-medium text-gray-700">{r.name}</span>
                                    <p className="text-xs mt-1">
                                      {formatRuleScopeLabel(r)}
                                      {phase === 'upcoming' && range ? ` · Schüler: Stufe ${stufe} (ab Stufe ${range.from})` : ''}
                                      {phase === 'unknown' ? ' · Klasse zuordnen für Stufen-Prüfung' : ''}
                                    </p>
                                  </li>
                                );
                              }

                              const pastZeitraum = phase === 'after';
                              
                              if (ruleType === 'belegung') {
                                const missing = (r.options || []).filter(opt => !historyFlat.includes(opt));
                                const hasAll = missing.length === 0;
                                return (
                                  <li key={r.id} className={`p-3 rounded-lg ${hasAll ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                        <span className="text-xs text-purple-700 font-medium">Alle Kurse</span>
                                        <div>
                                          <span className="font-medium">{r.name}</span>
                                          <span className={`ml-2 font-semibold ${hasAll ? 'text-green-700' : 'text-red-700'}`}>
                                            {hasAll ? 'Erfüllt' : pastZeitraum ? 'Nicht erfüllt (Zeitraum vorbei)' : 'Nicht erfüllt'}
                                          </span>
                                        </div>
                                        <p className="text-xs text-gray-600 mt-1">Alle: {(r.options || []).join(', ')} · {formatRuleZeitraumLabel(r)}</p>
                                        {!hasAll && missing.length > 0 && (
                                          <p className="text-xs text-red-700 mt-1">Offen: {missing.join(', ')}</p>
                                        )}
                                      </div>
                                    </div>
                                  </li>
                                );
                              }
                              if (ruleType === 'mindestbelegung') {
                                const minRequired = r.minCount || 1;
                                const distinctCount = countDistinctWorkshopsFromOptions(historyFlat, r.options);
                                const isMet = distinctCount >= minRequired;
                                return (
                                  <li key={r.id} className={`p-3 rounded-lg ${isMet ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                    <div>
                                      <span className="text-xs text-indigo-700 font-medium">Mindestanzahl</span>
                                      <div>
                                        <span className="font-medium">{r.name}</span>
                                        <span className={`ml-2 font-semibold ${isMet ? 'text-green-700' : 'text-red-700'}`}>
                                          {distinctCount}/{minRequired} Kurse · {isMet ? 'Erfüllt' : 'Offen'}
                                        </span>
                                      </div>
                                      <p className="text-xs text-gray-600 mt-1">
                                        Zählt aus: {(r.options || []).join(', ')}
                                      </p>
                                    </div>
                                  </li>
                                );
                              }
                              if (ruleType === 'freitext') {
                                const checked = !!manualRuleChecks[selectedStudent]?.[r.id];
                                return (
                                  <li key={r.id} className={`p-3 rounded-lg border ${checked ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                                    <label className="flex items-start gap-3 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleManualRuleCheck(selectedStudent, r.id)}
                                        className="mt-1 w-4 h-4 text-green-600 rounded border-gray-300"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <span className="text-xs text-amber-800 font-medium block">Manuelle Prüfung</span>
                                        <span className="font-medium text-gray-900">{r.name}</span>
                                        {r.description && (
                                          <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{r.description}</p>
                                        )}
                                      </div>
                                    </label>
                                  </li>
                                );
                              }
                              if (ruleType === 'folgekurs') {
                                const sortedHistory = [...studentHistory].sort((a, b) => {
                                  // Parse school year and trimester from slotKey (format: "YYYY-YYYY T#" or legacy "YYYY-T#")
                                  const aParsed = parseSchoolYearKey(a.slotKey);
                                  const bParsed = parseSchoolYearKey(b.slotKey);
                                  if (!aParsed || !bParsed) return 0;
                                  // Sort by school year start, then by trimester
                                  if (aParsed.schoolYearStart !== bParsed.schoolYearStart) {
                                    return aParsed.schoolYearStart - bParsed.schoolYearStart;
                                  }
                                  return aParsed.trimester - bParsed.trimester;
                                });
                                
                                // Check if there's a previous assignment of fromCourse and if toCourse is assigned in the next trimester
                                let isSatisfied = true;
                                let violationMessage = '';
                                
                                for (let i = 0; i < sortedHistory.length - 1; i++) {
                                  const current = sortedHistory[i];
                                  const next = sortedHistory[i + 1];
                                  
                                  // Check if fromCourse is in current trimester
                                  const hasFromCourse = workshopsFromHistoryEntry(current).includes(r.fromCourse);
                                  
                                  if (hasFromCourse) {
                                    const hasToCourse = workshopsFromHistoryEntry(next).includes(r.toCourse);
                                    
                                    if (!hasToCourse) {
                                      isSatisfied = false;
                                      violationMessage = `Nach ${r.fromCourse} muss ${r.toCourse} im nächsten Trimester belegt werden.`;
                                      break;
                                    }
                                    
                                    if (r.sameBand) {
                                      const fromBand = bandIdForCourse(current, r.fromCourse);
                                      const toBand = bandIdForCourse(next, r.toCourse);
                                      if (fromBand && toBand && fromBand !== toBand) {
                                        isSatisfied = false;
                                        violationMessage = `Nach ${r.fromCourse} muss ${r.toCourse} im gleichen Band belegt werden.`;
                                        break;
                                      }
                                    }
                                  }
                                }
                                
                                return (
                                  <li key={r.id} className={`p-3 rounded-lg ${isSatisfied ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <span className="font-medium">{r.name}</span> — 
                                        <span className={`ml-2 font-semibold ${isSatisfied ? 'text-green-700' : 'text-red-700'}`}>
                                          {isSatisfied ? 'Erfüllt' : 'Nicht erfüllt'}
                                        </span>
                                        {!isSatisfied && violationMessage && (
                                          <div className="text-xs text-red-600 mt-1">{violationMessage}</div>
                                        )}
                                      </div>
                                      <div className="group relative inline-block ml-2">
                                        <svg className="w-4 h-4 text-blue-500 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div className="absolute right-0 bottom-full mb-2 transform w-64 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                                          <strong>Folgekurs-Regel:</strong> Wenn der Schüler {r.fromCourse} belegt, muss er im nächsten Trimester {r.toCourse} belegen.{r.sameBand ? ' Der Folgekurs muss im gleichen Band sein.' : ''} {isSatisfied ? '✓ Regel ist erfüllt.' : '✗ Regel ist nicht erfüllt.'}
                                        </div>
                                      </div>
                                    </div>
                                  </li>
                                );
                              }
                              return null;
                            })}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                      <h3 className="text-base font-semibold text-gray-800 mb-3">Wahlabgabe (geladenes Trimester)</h3>
                      <div className="space-y-3">
                        {activeBandIds.map(bandId => {
                          const choices = getChoicesForBand(bandId)[selectedStudent];
                          const violations = choices
                            ? checkViolationsForStudent(selectedStudent, choices)
                            : [];
                          return (
                            <div key={bandId} className="rounded-lg border border-gray-200 p-3 bg-gray-50/80">
                              <div className="text-sm font-semibold text-gray-800 mb-2">{getBandLabel(bandId)}</div>
                              {!choices ? (
                                <p className="text-sm text-gray-500 italic">Keine Wahldaten für dieses Band.</p>
                              ) : (
                                <>
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {choices.map((choice, idx) => (
                                      <span
                                        key={idx}
                                        className="text-xs px-2 py-1 rounded-md bg-white border border-gray-200"
                                      >
                                        {idx + 1}. {choice}
                                      </span>
                                    ))}
                                  </div>
                                  {violations.length > 0 ? (
                                    <ul className="space-y-1">
                                      {violations.map((msg, idx) => (
                                        <li key={idx} className="text-xs p-2 bg-red-50 border border-red-200 rounded text-red-700">{msg}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-xs text-green-700">Keine Auffälligkeiten bei den Wahlen.</p>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                      <h3 className="text-base font-semibold text-gray-800 mb-3">Werkstatt-Historie</h3>
                      <div className="detail-content">
                        <StudentHistoryTable 
                          student={selectedStudent}
                          confirmedAssignments={confirmedAssignments}
                          workshops={[...Object.keys(workshops), ...Object.keys(archivedWorkshops)]}
                          onChangeAssignment={updateConfirmedAssignmentForStudent}
                          archivedWorkshops={archivedWorkshops}
                        />
                      </div>
                    </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
{tab === 'trimester' && (
        <section className="section">
          <TrimesterManagementPanel
            trimesterPlans={trimesterPlans}
            setTrimesterPlans={setTrimesterPlans}
            selectedKey={selectedTrimesterPlanKey}
            setSelectedKey={setSelectedTrimesterPlanKey}
            workshops={workshops}
            workshopColors={workshopColors}
            workshopTeachers={workshopTeachers}
            workshopRooms={workshopRooms}
            klassenStufenPool={klassenStufenPool}
            getWorkshopCapacity={getWorkshopCapacity}
            getDefaultSchoolYear={getDefaultSchoolYear}
            updateWorkshopCapacity={updateWorkshopCapacity}
            updateWorkshopRoom={updateWorkshopRoom}
            updateWorkshopTeacher={updateWorkshopTeacher}
            students={students}
            studentClasses={studentClasses}
            studentEnrollmentYears={studentEnrollmentYears}
            rules={rules}
            confirmedAssignments={confirmedAssignments}
            ruleAppliesToStudent={ruleAppliesToStudent}
            ruleEnforcesNow={ruleEnforcesNow}
            getRequiredFolgekurs={getRequiredFolgekurs}
            parseSchoolYearKey={parseSchoolYearKey}
            loadChoicesForTrimesterKey={loadChoicesForTrimesterKey}
            studentComments={studentComments}
          />
        </section>
      )}

{tab === 'wahl' && (
  <section className="wahl-tab space-y-6 w-full">
    {!wahlTrimesterDefined && (
      <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 text-amber-950">
        <p className="font-semibold">Kein Trimester-Plan für die aktuelle Auswahl</p>
        <p className="text-sm mt-1">Legen Sie unter „Trimester“ ein Trimester an, bevor Sie Wahlen hochladen oder zuordnen.</p>
        <button type="button" onClick={() => setTab('trimester')} className="mt-3 px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
          Trimester-Management öffnen
        </button>
      </div>
    )}
    <div className={!wahlTrimesterDefined ? 'opacity-60 pointer-events-none space-y-6' : 'space-y-6'}>
    {/* Kontext: Trimester & Band-Anzahl */}
    <div className="bg-white rounded-2xl shadow p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-11 h-11 rounded-full bg-indigo-600 text-white shadow-md flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Aktuelles Trimester</div>
            <div className="text-lg font-bold text-gray-900">
              {formatYearTrimester(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {activeTrimesterPlan ? (
            <span className="text-sm text-gray-600">
              <span className="font-medium">{activeTrimesterPlan.bandCount} Bänder</span>
              {' · '}
              <span className="font-medium">{activeTrimesterWahlCount} Wahlen</span> pro Schüler
            </span>
          ) : (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <span className="font-medium whitespace-nowrap">Parallel-Bänder:</span>
              <select
                value={activeBandCount}
                onChange={(e) => {
                  const count = Number(e.target.value);
                  setActiveBandCount(count);
                  if (!getBandIds(count).includes(activeBand)) {
                    setActiveBand(getBandIds(count)[0]);
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium bg-white"
              >
                {Array.from({ length: MAX_BANDS - 1 }, (_, i) => i + 2).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setShowTrimesterDialog(true)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors"
          >
            Trimester wechseln
          </button>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <div className="text-xs font-medium text-gray-500 mb-2">Band auswählen — Upload, Auto-Zuordnung und manuelle Anpassung beziehen sich auf dieses Band:</div>
        {bandSwitcher}
      </div>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* Schritt 1: Wahl-Upload & Vorschau */}
      <div className="xl:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-gray-200 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-3">
          <div>
            <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Schritt 1</div>
            <h3 className="text-lg font-semibold text-gray-900">Wahl-Datei — {getBandLabel(activeBand)}</h3>
            <p className="text-sm text-gray-500 mt-1">
              CSV oder Excel mit Schülernamen, Klasse und{' '}
              {activeTrimesterWahlCount === 1
                ? '1. Wahl'
                : `1.–${activeTrimesterWahlCount}. Wahl`}
              {' '}für dieses Band (laut Trimester-Plan).
            </p>
          </div>
          <label className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm cursor-pointer transition-colors whitespace-nowrap">
            <input
              ref={el => { fileInputRefs.current[activeBand] = el; }}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => handleFileUpload(e, activeBand)}
              className="hidden"
            />
            Datei hochladen
          </label>
        </div>

        {!Object.keys(getChoicesForBand(activeBand)).length && (
          <div className="p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600">
            Für {getBandLabel(activeBand)} liegen noch keine Wahldaten vor. Laden Sie eine Datei hoch — bei abweichenden Spaltennamen öffnet sich die Spaltenzuordnung automatisch.
          </div>
        )}

        {uploadSummary && uploadSummary.band === getBandLabel(activeBand) && (
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-semibold text-gray-800 text-sm">Upload-Zusammenfassung</h4>
              <button type="button" onClick={() => setUploadSummary(null)} className="text-gray-500 hover:text-gray-700">×</button>
            </div>
            <div className="text-sm space-y-2">
              {uploadSummary.newStudents.length > 0 && (
                <p className="text-green-800"><strong>Neue Schüler:</strong> {uploadSummary.newStudents.length}</p>
              )}
              {uploadSummary.updatedClasses.length > 0 && (
                <p className="text-blue-800"><strong>Klassen aktualisiert:</strong> {uploadSummary.updatedClasses.length}</p>
              )}
              {uploadSummary.newWorkshops.length > 0 && (
                <p className="text-purple-800"><strong>Neue Werkstätten:</strong> {uploadSummary.newWorkshops.length}</p>
              )}
              {uploadSummary.updatedChoices > 0 && (
                <p className="text-amber-800"><strong>Wahlen aktualisiert:</strong> {uploadSummary.updatedChoices} Schüler</p>
              )}
              {uploadSummary.inferredEnrollmentYears?.length > 0 && (
                <p className="text-teal-800">
                  <strong>Einschulungsjahr neu gesetzt:</strong>{' '}
                  {uploadSummary.inferredEnrollmentYears.length} Schüler (beim ersten Wahl-Upload)
                </p>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Wahl-Vorschau ({Object.keys(getChoicesForBand(activeBand)).length} Schüler)</div>
          <div className="max-h-[320px] overflow-y-auto border border-gray-200 rounded-lg text-sm">
            {Object.entries(getChoicesForBand(activeBand)).slice(0, 150).map(([student, choices]) => {
              const needsAssistant = studentAssistants[student];
              return (
                <div
                  key={student}
                  className={`flex justify-between border-b py-2 px-2 rounded-lg transition-all duration-200 ${
                    needsAssistant 
                      ? 'bg-gradient-to-r from-blue-50 to-indigo-100 border-l-4 border-blue-400 hover:from-blue-100 hover:to-indigo-200' 
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center">
                    <div className="font-medium">{student}</div>
                    <span className="ml-2 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded">
                      {studentClasses[student] || '—'}
                    </span>
                    {needsAssistant && (
                      <span className="ml-2 px-2 py-0.5 bg-blue-200 text-blue-800 text-xs font-semibold rounded-full flex items-center">
                        <div className="w-2 h-2 bg-blue-600 rounded-full mr-1"></div>
                        Lernbegleitung
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-1 max-w-[55%]">
                    {Array.from({ length: activeTrimesterWahlCount }, (_, i) => {
                      const c = choices[i];
                      return (
                        <span
                          key={i}
                          className="px-3 py-1 rounded-lg text-xs shadow-sm font-medium"
                          style={{
                            backgroundColor: workshopColors[c] ? `${workshopColors[c]}20` : undefined,
                            borderLeft: workshopColors[c] ? `3px solid ${workshopColors[c]}` : undefined,
                            color: workshopColors[c] || undefined,
                          }}
                        >
                          {i + 1}. {c || '—'}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Schritt 2: Auto-Zuordnung */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-6 shadow-sm border border-emerald-200 flex flex-col">
        <div className="border-b border-emerald-200 pb-3 mb-4">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Schritt 2</div>
          <h3 className="text-lg font-semibold text-gray-900">Automatische Zuordnung</h3>
          <p className="text-sm text-gray-600 mt-1">
            Berücksichtigt bereits zugeordnete andere Bänder (gleiche Werkstatt / Parallel-Regeln).
          </p>
        </div>

        <div className="space-y-2 mb-4">
          <button
            type="button"
            onClick={() => runAutoAssignForBand(activeBand)}
            className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
          >
            Auto-Zuordnung: {getBandLabel(activeBand)}
          </button>
          <button
            type="button"
            onClick={runAutoAssign}
            className="w-full px-4 py-2.5 bg-white border-2 border-emerald-600 text-emerald-800 hover:bg-emerald-50 text-sm font-semibold rounded-lg transition-colors"
          >
            Alle {activeBandCount} Bänder nacheinander zuordnen
          </button>
        </div>

          {/* Display statistics - use currentStatistics if available, otherwise autoResult */}
          {(hasAnyAssignmentInBands(dragAssignments, activeBandIds) || autoResult) && (
            <>
              <div className="text-gray-700 mb-3 text-sm">
                {(() => {
                  const stats = hasAnyAssignmentInBands(dragAssignments, activeBandIds)
                    ? currentStatistics 
                    : autoResult;
                  
                  if (!stats) return null;
                  
                  return (
                    <>
                      <p>
                        <strong>{stats.percentFirst.toFixed(2)}%</strong> der Zuweisungen waren erste Wahlen.
                      </p>
                      <p>
                        Erste Wahl: <b>{stats.totalFirst}</b> | Zweite Wahl: <b>{stats.totalSecond}</b>
                      </p>
                      <div className="mt-2 text-xs space-y-2">
                        {activeBandIds.map(bandId => {
                          const bandStats = stats.perBand?.[bandId] || 
                            (bandId === 'erstesBand' ? stats.erstesBand : bandId === 'zweitesBand' ? stats.zweitesBand : null);
                          return (
                            <div key={bandId}>
                              <div className="font-semibold">{getBandLabel(bandId)}:</div>
                              <div className="ml-3">
                                {bandStats && bandStats.total > 0 ? (
                                  <>
                                    <strong>{bandStats.percentFirst.toFixed(2)}%</strong> erste Wahlen ({bandStats.num1} erste, {bandStats.num2} zweite von {bandStats.total} Zuweisungen)
                                  </>
                                ) : (
                                  <>Keine Zuweisungen mit Wahlen</>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
                          <div className="font-semibold text-blue-800 flex items-center">
                            <div className="w-2 h-2 bg-blue-600 rounded-full mr-2"></div>
                            Lernbegleitung:
                          </div>
                          <div className="text-blue-700">
                            {Object.values(studentAssistants).filter(Boolean).length} Schüler benötigen Lernbegleitung
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {autoResult && autoResult.problems && autoResult.problems.length > 0 && (
                <details className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  <summary className="font-semibold cursor-pointer">
                    {autoResult.problems.length} Warnungen anzeigen
                  </summary>
                  <ul className="list-disc list-inside mt-2 space-y-2">
                    {autoResult.problems.map((p, i) => {
                      // Handle both old format (string) and new format (object with band info)
                      const message = typeof p === 'string' ? p : p.message;
                      const bandLabel = typeof p === 'object' && p.bandLabel ? p.bandLabel : '';
                      const warningKey = `auto-problem-${i}-${message}`;
                      const isChecked = checkedWarnings[warningKey] || false;
                      return (
                        <li key={i} className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleWarningCheck(warningKey)}
                            className="mt-0.5 cursor-pointer"
                          />
                          <span className={isChecked ? 'line-through opacity-60' : ''}>
                            {bandLabel && <strong>[{bandLabel}]</strong>} {message}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </>
          )}
          
          {!autoResult && !hasAnyAssignmentInBands(dragAssignments, activeBandIds) && (
            <div className="text-gray-500 italic text-sm">
              Noch keine automatische Zuordnung durchgeführt.
            </div>
          )}
        </div>
      </div>

      {/* Schritt 3: Manuelle Anpassung */}
      <div className="bg-gradient-to-br from-purple-50 to-violet-100 rounded-xl p-6 shadow-sm border border-purple-200">
        <div className="flex items-center justify-between mb-4 border-b border-purple-300 pb-2">
          <div>
            <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Schritt 3</div>
            <h3 className="text-lg font-semibold text-purple-900">
              Manuelle Anpassung — {getBandLabel(activeBand)}
            </h3>
          </div>
          {/* Student Search */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={studentSearchQuery}
                onChange={(e) => {
                  const query = e.target.value;
                  setStudentSearchQuery(query);
                  
                  if (query.trim()) {
                    // Find student matching the query
                    const matchingStudent = students.find(s => 
                      s.toLowerCase().includes(query.toLowerCase())
                    );
                    
                    if (matchingStudent) {
                      // Find which workshop the student is in
                      const assignment = getAssignmentsForBand(activeBand)[matchingStudent];
                      const workshopName = assignment && assignment !== 'Nicht Zugeordnet' && assignment !== 'Nicht Zugeordnen' 
                        ? assignment 
                        : 'Nicht Zugeordnet';
                      
                      // Scroll to the student card
                      setTimeout(() => {
                        const studentRef = studentCardRefs.current[`${workshopName}-${matchingStudent}`];
                        if (studentRef && scrollContainerRef.current) {
                          // Scroll the container to show the student
                          const container = scrollContainerRef.current;
                          const cardRect = studentRef.getBoundingClientRect();
                          const containerRect = container.getBoundingClientRect();
                          
                          // Calculate scroll position to center the card
                          const scrollLeft = container.scrollLeft + (cardRect.left - containerRect.left) - (containerRect.width / 2) + (cardRect.width / 2);
                          container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
                        }
                      }, 100);
                    }
                  }
                }}
                placeholder="Schüler suchen..."
                className="pl-8 pr-8 py-1.5 text-sm border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent w-48"
              />
              <svg className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {studentSearchQuery && (
                <button
                  onClick={() => setStudentSearchQuery('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {bandWarningGroups().map(group => {
          const bandLabel = getBandLabel(group.bandId);
          const cards = [];
          if (group.missing.length) {
            cards.push({
              key: `no-votes-${group.bandId}`,
              tone: 'amber',
              title: `${group.missing.length} erwartete ${group.missing.length === 1 ? 'Stimme fehlt' : 'Stimmen fehlen'} (${bandLabel})`,
              lines: group.missing.map(student => `${student}${studentClasses[student] ? ` (${studentClasses[student]})` : ''}`),
            });
          }
          if (group.selfParallel.length) {
            cards.push({
              key: `self-parallel-${group.bandId}`,
              tone: 'yellow',
              title: `${group.selfParallel.length} ${group.selfParallel.length === 1 ? 'Zuordnung verletzt' : 'Zuordnungen verletzen'} „nicht parallel zu sich selbst“ (${bandLabel})`,
              lines: group.selfParallel.map(item => `${item.student}: ${item.workshop} auch in ${getBandLabel(item.otherBandId)}`),
            });
          }
          if (group.ruleParallel.length) {
            cards.push({
              key: `rule-parallel-${group.bandId}`,
              tone: 'red',
              title: `${group.ruleParallel.length} ${group.ruleParallel.length === 1 ? 'Zuordnung verletzt' : 'Zuordnungen verletzen'} eine Parallel-Regel (${bandLabel})`,
              lines: group.ruleParallel.map(item => `${item.student}: ${item.workshop} neben ${item.otherWorkshop} in ${getBandLabel(item.otherBandId)}`),
            });
          }
          if (group.sameFirst.length) {
            cards.push({
              key: `same-first-${group.bandId}`,
              tone: 'orange',
              title: `${group.sameFirst.length} ${group.sameFirst.length === 1 ? 'Schüler hat' : 'Schüler haben'} dieselbe erste Wahl wie in einem anderen Band (${bandLabel})`,
              lines: group.sameFirst.map(item => `${item.student}: ${item.workshop} auch erste Wahl in ${getBandLabel(item.otherBandId)}`),
            });
          }
          return cards.map(card => {
            const isChecked = checkedWarnings[card.key] || false;
            const tone = {
              amber: 'bg-amber-50 border-amber-400 text-amber-800',
              yellow: 'bg-yellow-50 border-yellow-400 text-yellow-800',
              red: 'bg-red-50 border-red-300 text-red-800',
              orange: 'bg-orange-50 border-orange-400 text-orange-800',
            }[card.tone];
            return (
              <div key={card.key} className={`mb-4 rounded-lg border-2 p-4 ${tone} ${isChecked ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleWarningCheck(card.key)}
                    className="mt-0.5 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className={`font-semibold mb-1 ${isChecked ? 'line-through' : ''}`}>{card.title}</div>
                    <div className={`text-sm max-h-32 overflow-y-auto space-y-0.5 ${isChecked ? 'line-through opacity-60' : ''}`}>
                      {card.lines.slice(0, 12).map(line => (
                        <div key={line}>{line}</div>
                      ))}
                      {card.lines.length > 12 && <div>… und {card.lines.length - 12} weitere</div>}
                    </div>
                  </div>
                </div>
              </div>
            );
          });
        })}

        <div className="relative">
          {/* Top scrollbar container - mirror of main content for visual scrollbar */}
          <div ref={topScrollbarRef} className="overflow-x-auto w-full mb-2" style={{ scrollbarWidth: 'thin', height: '17px' }}>
            <div className="flex gap-4" style={{ minWidth: 'max-content', width: '100%' }}>
              {wahlVisibleWorkshops.map((w) => (
                <div key={w} className="flex-shrink-0" style={{ width: `${Math.max(220, Math.min(280, windowWidth / (wahlVisibleWorkshops.length + 1) - 40))}px` }}>
                  {/* Empty div to match workshop width */}
                </div>
              ))}
              <div className="flex-shrink-0" style={{ width: `${Math.max(220, Math.min(280, windowWidth / (wahlVisibleWorkshops.length + 1) - 40))}px` }}>
                {/* Empty div for "Nicht Zugeordnet" column */}
              </div>
            </div>
          </div>
          
          <div 
            ref={scrollContainerRef}
            className="overflow-x-auto pb-4 w-full"
            style={{ 
              scrollBehavior: 'auto',
              scrollbarWidth: 'thin'
            }}
          >
          <div className="flex gap-4 h-full" style={{ minWidth: 'max-content', width: '100%', minHeight: '500px' }}>
            {wahlVisibleWorkshops.map((w) => {
              const currentCount = getCurrentWorkshopCounts()[w] || 0;
              const capacity = getWahlWorkshopCapacity(w);
              const isHovering = dragHover.workshop === w;
              const violationMessage = dropViolations[w];
              const persistentViols = persistentViolations[w] || {};
              const hasPersistentViolations = Object.keys(persistentViols).length > 0;

              return (
                <div
                  key={w}
                  className={`rounded-xl border-2 transition-all duration-200 shadow-sm flex-shrink-0 flex-grow`}
                  style={{ 
                    minWidth: '220px', 
                    maxWidth: '280px',
                    width: `${Math.max(220, Math.min(280, windowWidth / (wahlVisibleWorkshops.length + 1) - 40))}px`,
                    minHeight: '500px'
                  }}
                  onDragOver={(e) => handleDragOver(e, w)}
                  onDragEnter={(e) => handleDragEnter(e, w)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, w)}
                >
                  <div className={`rounded-xl h-full border-2 p-4 transition-all duration-200 ${
                    isHovering 
                      ? 'border-indigo-400 bg-gradient-to-br from-indigo-50 to-blue-100 shadow-lg transform scale-105' 
                      : hasPersistentViolations
                      ? 'border-red-300 bg-gradient-to-br from-red-50 to-orange-50'
                      : 'border-gray-300 bg-gradient-to-br from-white to-gray-50 hover:shadow-md hover:border-gray-400'
                  }`}
                  style={{
                    borderLeftWidth: workshopColors[w] ? '6px' : undefined,
                    borderLeftColor: workshopColors[w] || undefined
                  }}>
                  <div className="flex justify-between mb-2 items-center">
                    <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{w}</span>
                      {workshopColors[w] && (
                        <div 
                          className="w-4 h-4 rounded-full border border-gray-300 shadow-sm"
                          style={{ backgroundColor: workshopColors[w] }}
                          title={`Kategorie: ${workshopColors[w]}`}
                        />
                      )}
                    </div>
                    <span className={`text-xs ${currentCount >= capacity ? 'text-red-600' : 'text-gray-500'}`}>
                      {currentCount}/{capacity}
                    </span>
                  </div>

                  {hasPersistentViolations && (
                    <div className="mb-2 p-2 bg-red-100 border border-red-300 rounded-lg">
                      <div className="text-xs font-semibold text-red-800 mb-1">⚠️ Regelverstöße:</div>
                      <div className="space-y-1">
                        {Object.entries(persistentViols).map(([student, msg]) => (
                          <div key={student} className="text-xs text-red-700">
                            <span className="font-medium">{student}:</span> {msg}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1 min-h-[80px]">
                    {Object.entries(getAssignmentsForBand(activeBand))
                      .filter(([s, a]) => a === w && a !== undefined && a !== null)
                      .map(([s]) => (
                        <div
                          key={s}
                          ref={(el) => {
                            if (el) {
                              studentCardRefs.current[`${w}-${s}`] = el;
                            } else {
                              delete studentCardRefs.current[`${w}-${s}`];
                            }
                          }}
                          draggable
                          onDragStart={(e) => handleDragStart(e, s)}
                          className={`cursor-move px-3 py-2 rounded-lg text-xs flex justify-between items-start shadow-sm flex-col transition-all duration-200 hover:shadow-md ${
                            studentSearchQuery && s.toLowerCase().includes(studentSearchQuery.toLowerCase())
                              ? 'bg-gradient-to-r from-blue-200 to-blue-300 border-2 border-blue-500 shadow-lg ring-2 ring-blue-400'
                              : persistentViols[s]
                              ? 'bg-gradient-to-r from-red-100 to-orange-100 border border-red-200 hover:from-red-200 hover:to-orange-200'
                              : hasNoVotesForBand(s, activeBand)
                              ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border-2 border-yellow-300 hover:from-yellow-100 hover:to-amber-100'
                              : 'bg-gradient-to-r from-white to-gray-50 border border-gray-200 hover:from-gray-100 hover:to-gray-200'
                          }`}
                        >
                          <div className="flex items-center w-full">
                            <div className="font-medium">{s}</div>
                            <span className="ml-1 px-1.5 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded">
                              {studentClasses[s] || '—'}
                            </span>
                            {studentAssistants[s] && (
                              <div className="ml-1 w-2 h-2 bg-blue-600 rounded-full"></div>
                            )}
                            {persistentViols[s] && (
                              <div className="ml-1 w-2 h-2 bg-red-600 rounded-full"></div>
                            )}
                            {hasNoVotesForBand(s, activeBand) && (
                              <div className="ml-1 w-2 h-2 bg-yellow-500 rounded-full" title="Keine Wahlen abgegeben"></div>
                            )}
                          </div>
                          {getChoicesForBand(activeBand)[s] ? (
                            <div className="text-xs text-gray-600 flex gap-1 mt-1">
                              <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">1. {getChoicesForBand(activeBand)[s][0] || '—'}</span>
                              <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">2. {getChoicesForBand(activeBand)[s][1] || '—'}</span>
                            </div>
                          ) : (
                            <div className="text-xs text-yellow-700 italic mt-1">
                              ⚠️ Keine Wahlen abgegeben
                            </div>
                          )}
                        </div>
                      ))}
                  </div>

                  {violationMessage && (
                    <div className="text-xs text-red-600 mt-2">{violationMessage}</div>
                  )}
                  </div>
                </div>
              );
            })}

            {/* --- Not Assigned Column --- */}
            <div
              className="rounded-xl border-2 border-orange-300 bg-gradient-to-br from-orange-50 to-red-100 shadow-sm hover:shadow-md transition-all duration-200 flex-shrink-0 flex-grow"
              style={{ 
                minWidth: '220px', 
                maxWidth: '280px',
                width: `${Math.max(220, Math.min(280, windowWidth / (Object.keys(workshops).length + 1) - 40))}px`,
                minHeight: '500px'
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const student = e.dataTransfer.getData('text/plain');
                if (!student) return;
                // Update state (auto-save is handled by useEffect)
                setDragAssignments(prev => ({
                  ...prev,
                  [activeBand]: { ...prev[activeBand], [student]: 'Nicht Zugeordnen' }
                }));
                if (!studentExpectedOnBand(student, activeBand)) {
                  setExtraUnassignedByBand(prev => {
                    const list = prev[activeBand] || [];
                    if (list.includes(student)) return prev;
                    return { ...prev, [activeBand]: [...list, student] };
                  });
                }
                
                // Clear all persistent violations for this student
                setPersistentViolations(prev => {
                  const updated = { ...prev };
                  Object.keys(updated).forEach(workshopName => {
                    if (updated[workshopName] && updated[workshopName][student]) {
                      const copy = { ...updated[workshopName] };
                      delete copy[student];
                      if (Object.keys(copy).length === 0) {
                        delete updated[workshopName];
                      } else {
                        updated[workshopName] = copy;
                      }
                    }
                  });
                  return updated;
                });
              }}
            >
              <div className="rounded-xl h-full border-2 p-4 border-orange-300 bg-gradient-to-br from-orange-50 to-red-100">
              <div className="flex justify-between mb-2">
                <span className="font-semibold text-sm">Nicht Zugeordnet</span>
                <span className="text-xs text-gray-500">
                  {unassignedStudentsForBand(activeBand).length}
                </span>
              </div>

              <div className="space-y-1 min-h-[80px]">
                {unassignedStudentsForBand(activeBand)
                  .map((s) => (
                    <div
                      key={s}
                      ref={(el) => {
                        if (el) {
                          studentCardRefs.current[`Nicht Zugeordnet-${s}`] = el;
                        } else {
                          delete studentCardRefs.current[`Nicht Zugeordnet-${s}`];
                        }
                      }}
                      draggable
                      onDragStart={(e) => handleDragStart(e, s)}
                      className={`cursor-move px-3 py-2 rounded-lg text-xs shadow-sm flex flex-col transition-all duration-200 hover:shadow-md ${
                        studentSearchQuery && s.toLowerCase().includes(studentSearchQuery.toLowerCase())
                          ? 'bg-gradient-to-r from-blue-200 to-blue-300 border-2 border-blue-500 shadow-lg ring-2 ring-blue-400'
                          : hasNoVotesForBand(s, activeBand)
                          ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border-2 border-yellow-300 hover:from-yellow-100 hover:to-amber-100'
                          : 'bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 hover:from-orange-100 hover:to-red-100'
                      }`}
                    >
                      <div className="flex items-center w-full">
                        <div className="font-medium">{s}</div>
                        <span className="ml-1 px-1.5 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded">
                          {studentClasses[s] || '—'}
                        </span>
                        {studentAssistants[s] && (
                          <div className="ml-1 w-2 h-2 bg-blue-600 rounded-full"></div>
                        )}
                        {hasNoVotesForBand(s, activeBand) && (
                          <div className="ml-1 w-2 h-2 bg-yellow-500 rounded-full" title="Keine Wahlen abgegeben"></div>
                        )}
                      </div>
                      {getChoicesForBand(activeBand)[s] ? (
                        <div className="text-xs text-gray-600 flex gap-1 mt-1">
                          <span className="px-1.5 py-0.5 bg-orange-100 rounded text-xs">1. {getChoicesForBand(activeBand)[s][0] || '—'}</span>
                          <span className="px-1.5 py-0.5 bg-orange-100 rounded text-xs">2. {getChoicesForBand(activeBand)[s][1] || '—'}</span>
                        </div>
                      ) : (
                        <div className="text-xs text-yellow-700 italic mt-1">
                          ⚠️ Keine Wahlen abgegeben
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              <div className="mt-3 border-t border-orange-300 pt-3">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Schüler hinzufügen</label>
                <input
                  type="text"
                  value={addUnassignedQuery}
                  onChange={(e) => setAddUnassignedQuery(e.target.value)}
                  placeholder="Name suchen…"
                  className="w-full px-2 py-1.5 text-xs border-2 border-slate-400 rounded-lg bg-white"
                />
                {addUnassignedQuery.trim() && (
                  <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border-2 border-slate-300 bg-white">
                    {(() => {
                      const query = addUnassignedQuery.trim().toLowerCase();
                      const shown = new Set(unassignedStudentsForBand(activeBand));
                      const matches = students.filter(student => {
                        if (!student.toLowerCase().includes(query)) return false;
                        if (!isOpenAssignment(dragAssignments[activeBand]?.[student])) return false;
                        return !shown.has(student);
                      }).slice(0, 8);
                      if (!matches.length) {
                        return <div className="px-2 py-1.5 text-xs text-slate-500">Kein Treffer</div>;
                      }
                      return matches.map(student => (
                        <button
                          key={student}
                          type="button"
                          onClick={() => addStudentToUnassigned(student)}
                          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-orange-50"
                        >
                          <span className="font-medium text-slate-800">{student}</span>
                          <span className="text-slate-500">
                            {studentClasses[student] || '—'}
                            {studentEnrollmentYears[student] ? ` · ${studentEnrollmentYears[student]}` : ''}
                          </span>
                        </button>
                      ));
                    })()}
                  </div>
                )}
              </div>
              </div>
              </div>
            </div>
          </div>
        </div>
        
      </div>
      <div className="bg-white rounded-2xl shadow p-5">
        <div className="text-xs font-medium text-gray-500 mb-2">Band auswählen — Upload, Auto-Zuordnung und manuelle Anpassung beziehen sich auf dieses Band:</div>
        {bandSwitcher}
      </div>
    </div>
  </section>
)}

{tab === 'reports' && (
  <section className="reports-tab space-y-8">
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Berichte herunterladen</h2>
      <p className="text-sm text-gray-600 mb-6">PDF- und Excel-Auswertungen für das gewählte Trimester. Backup und Import finden Sie unter <strong>Daten</strong> oben.</p>
      
      {/* School Year/Trimester Selection */}
      <div className="bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 rounded-xl p-5 mb-8 shadow-md border-2 border-indigo-200">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <div className="text-sm text-gray-600 font-medium">Bericht für</div>
              <div className="text-lg font-bold text-indigo-900">
                {formatYearTrimester(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester)}
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowReportsTrimesterDialog(true)}
            className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white text-sm font-semibold rounded-lg shadow-md hover:from-indigo-700 hover:to-indigo-800 hover:shadow-lg transition-all duration-200 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Anderes Trimester wählen
          </button>
        </div>
      </div>

      {/* Available Reports */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Workshop Overview Report */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 shadow-sm border border-green-200">
          <h3 className="text-lg font-semibold text-green-900 mb-3 border-b border-green-300 pb-2">Werkstatt-Übersicht</h3>
          <p className="text-sm text-green-700 mb-4">
            Umfassende Übersicht aller Werkstätten mit:
          </p>
          <ul className="text-xs text-green-600 mb-4 list-disc list-inside space-y-1">
            <li>Lehrkraft und Raum pro Werkstatt</li>
            <li>Kapazität und Belegung (Erstes & Zweites Band)</li>
            <li>Alle zugeordneten Schüler mit Klasse</li>
            <li>Lernbegleitung-Status</li>
          </ul>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={generatePDFAllWorkshopsReport}
                className="px-4 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200 text-sm"
              >
                📊 PDF: Alle Werkstätten
              </button>
              <button 
                onClick={generateExcelAllWorkshopsReport}
                className="px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white font-semibold rounded-lg shadow-sm hover:from-green-700 hover:to-green-800 hover:shadow-md transition-all duration-200 text-sm"
              >
                📗 Excel: Alle Werkstätten
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={generatePDFWorkshopReports}
                className="px-4 py-3 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg shadow-sm hover:from-green-500 hover:to-green-600 hover:shadow-md transition-all duration-200 text-sm"
              >
                📊 PDF: Einzelne Werkstätten
              </button>
              <button 
                onClick={generateExcelWorkshopReports}
                className="px-4 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200 text-sm"
              >
                📗 Excel: Einzelne Werkstätten
              </button>
            </div>
          </div>
        </div>

        {/* Class Report */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl p-6 shadow-sm border border-blue-200">
          <h3 className="text-lg font-semibold text-blue-900 mb-3 border-b border-blue-300 pb-2">Klassen-Berichte</h3>
          <p className="text-sm text-blue-700 mb-4">
            Umfassende Berichte für alle Klassen mit:
          </p>
          <ul className="text-xs text-blue-600 mb-4 list-disc list-inside space-y-1">
            <li>Alle Schüler pro Klasse</li>
            <li>Werkstatt-Zuordnungen für beide Bänder</li>
            <li>Lernbegleitung-Status</li>
          </ul>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={generatePDFAllClassesReport}
                className="px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg shadow-sm hover:from-blue-600 hover:to-blue-700 hover:shadow-md transition-all duration-200 text-sm"
              >
                📋 PDF: Alle Klassen
              </button>
              <button 
                onClick={generateExcelAllClassesReport}
                className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg shadow-sm hover:from-blue-700 hover:to-blue-800 hover:shadow-md transition-all duration-200 text-sm"
              >
                📗 Excel: Alle Klassen
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={generatePDFClassReports}
                className="px-4 py-3 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg shadow-sm hover:from-blue-500 hover:to-blue-600 hover:shadow-md transition-all duration-200 text-sm"
              >
                📋 PDF: Einzelne Klassen
              </button>
              <button 
                onClick={generateExcelClassReports}
                className="px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg shadow-sm hover:from-blue-600 hover:to-blue-700 hover:shadow-md transition-all duration-200 text-sm"
              >
                📗 Excel: Einzelne Klassen
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 shadow-sm border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Verfügbare Trimester-Daten</h3>
        <div className="text-sm text-gray-600">
          <div className="flex flex-wrap gap-2">
            {Object.keys(confirmedAssignments).length > 0 ? (
              Object.keys(confirmedAssignments).map(key => (
                <span key={key} className="px-3 py-1 bg-white rounded-lg border border-gray-200 text-xs font-medium">
                  {key}
                </span>
              ))
            ) : (
              <span className="text-gray-500 italic">Keine gespeicherten Zuweisungen</span>
            )}
          </div>
        </div>
      </div>

    </div>
  </section>
)}

      {tab === 'workshops' && (
        <section className="section flex flex-col min-h-[calc(100vh-10rem)]">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 flex flex-col flex-1 min-h-[32rem] overflow-hidden">
            <div className="grid grid-cols-1 xl:grid-cols-5 flex-1 min-h-0">
              <aside className="xl:col-span-2 flex flex-col min-h-[22rem] xl:min-h-0 border-b xl:border-b-0 xl:border-r border-gray-200 bg-gradient-to-b from-blue-50/80 to-indigo-50/40">
                <div className="px-5 py-4 border-b border-blue-200/80 shrink-0 space-y-3">
                  <div>
                    <h3 className="text-lg font-semibold text-blue-900">Werkstätten</h3>
                    <p className="text-xs text-blue-800/70 mt-1">
                      {Object.keys(workshops).length} aktiv
                      {Object.keys(archivedWorkshops).length > 0 ? ` · ${Object.keys(archivedWorkshops).length} archiviert` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveWorkshopEditor('new')}
                    className="w-full px-4 py-2.5 rounded-lg font-semibold text-sm bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
                  >
                    + Neue Werkstatt
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
                  {Object.keys(workshops).length === 0 && Object.keys(archivedWorkshops).length === 0 && (
                    <div className="text-gray-500 italic p-6 bg-white/70 rounded-xl text-center border border-dashed border-blue-200 text-sm">
                      Noch keine Werkstätten. Oben „Neue Werkstatt“ wählen.
                    </div>
                  )}
                  {[...Object.keys(workshops)].sort((a, b) => a.localeCompare(b, 'de')).map(name => {
                    const cap = getWorkshopCapacity(workshops[name], name);
                    const isSelected = activeWorkshopEditor?.type === 'active' && activeWorkshopEditor.name === name;
                    const dot = workshopColors[name];
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setActiveWorkshopEditor({ type: 'active', name })}
                        className={`w-full text-left rounded-xl p-3 border transition-all ${
                          isSelected
                            ? 'bg-white border-blue-400 ring-2 ring-blue-200 shadow-md'
                            : 'bg-white/90 border-gray-200/90 hover:border-blue-200 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {dot ? (
                            <span className="w-3 h-3 rounded-full shrink-0 border border-gray-300" style={{ backgroundColor: dot }} />
                          ) : (
                            <span className="w-3 h-3 rounded-full shrink-0 bg-gray-200 border border-gray-300" />
                          )}
                          <span className="font-semibold text-gray-800 truncate flex-1">{name}</span>
                          <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">{cap} Pl.</span>
                        </div>
                      </button>
                    );
                  })}
                  {Object.keys(archivedWorkshops).length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-3 px-1">Archiviert</p>
                      {[...Object.keys(archivedWorkshops)].sort((a, b) => a.localeCompare(b, 'de')).map(name => {
                        const isSelected = activeWorkshopEditor?.type === 'archived' && activeWorkshopEditor.name === name;
                        return (
                          <button
                            key={`arch-${name}`}
                            type="button"
                            onClick={() => setActiveWorkshopEditor({ type: 'archived', name })}
                            className={`w-full text-left rounded-xl p-3 border transition-all ${
                              isSelected
                                ? 'bg-gray-50 border-gray-400 ring-2 ring-gray-200 shadow-md'
                                : 'bg-gray-50/80 border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-gray-600 truncate flex-1">{name}</span>
                              <span className="text-[10px] px-2 py-0.5 bg-gray-400 text-white rounded-full shrink-0">Archiv</span>
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </aside>
              <main className="xl:col-span-3 flex flex-col min-h-[28rem] xl:min-h-0 bg-gradient-to-br from-green-50/90 to-emerald-50/50">
                <div className="px-6 py-4 border-b border-green-200/80 shrink-0">
                  <h3 className="text-lg font-semibold text-green-900">
                    {activeWorkshopEditor === 'new'
                      ? 'Neue Werkstatt anlegen'
                      : activeWorkshopEditor != null
                        ? 'Werkstatt bearbeiten'
                        : 'Werkstatt-Editor'}
                  </h3>
                  <p className="text-xs text-green-900/70 mt-1">
                    {activeWorkshopEditor == null
                      ? 'Links eine Werkstatt wählen oder „Neue Werkstatt“ starten'
                      : activeWorkshopEditor === 'new'
                        ? 'Name und Kapazität festlegen'
                        : activeWorkshopEditor.type === 'archived'
                          ? 'Archivierte Werkstatt · Reaktivieren oder endgültig löschen'
                          : 'Kapazität, Bänder, Lehrkraft und Regeln'}
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
                  {activeWorkshopEditor == null ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[16rem] text-center text-gray-500 px-4">
                      <p className="text-sm max-w-sm">
                        Wählen Sie links eine Werkstatt, oder klicken Sie auf <strong>+ Neue Werkstatt</strong>.
                      </p>
                    </div>
                  ) : activeWorkshopEditor === 'new' ? (
                    <AddWorkshopForm onAdd={(n, c) => addWorkshop(n, c)} />
                  ) : activeWorkshopEditor.type === 'active' && !workshops[activeWorkshopEditor.name] ? (
                    <div className="text-sm text-gray-600">
                      Diese Werkstatt existiert nicht mehr.{' '}
                      <button type="button" className="text-blue-700 underline" onClick={() => setActiveWorkshopEditor(null)}>Schließen</button>
                    </div>
                  ) : activeWorkshopEditor.type === 'archived' && !archivedWorkshops[activeWorkshopEditor.name] ? (
                    <div className="text-sm text-gray-600">
                      Archiv-Eintrag nicht mehr vorhanden.{' '}
                      <button type="button" className="text-blue-700 underline" onClick={() => setActiveWorkshopEditor(null)}>Schließen</button>
                    </div>
                  ) : activeWorkshopEditor.type === 'active' ? (
                    <WorkshopDetailEditor
                      key={activeWorkshopEditor.name}
                      name={activeWorkshopEditor.name}
                      isArchived={false}
                      workshop={workshops[activeWorkshopEditor.name]}
                      workshopColors={workshopColors}
                      workshopTeachers={workshopTeachers}
                      workshopRooms={workshopRooms}
                      prereqs={prereqs}
                      cannotBeParallel={cannotBeParallel}
                      allowSelfParallel={allowSelfParallel}
                      onToggleSelfParallel={(name, allowed) => {
                        setAllowSelfParallel(prev => {
                          const next = { ...prev };
                          if (allowed) next[name] = true;
                          else delete next[name];
                          return next;
                        });
                      }}
                      onColorChange={updateWorkshopColor}
                      onCapacityChange={updateWorkshopCapacity}
                      onBandToggle={(n, bandId, checked, availableBands) => {
                        const newBands = checked
                          ? [...availableBands.filter(b => b !== bandId), bandId]
                          : availableBands.filter(b => b !== bandId);
                        updateWorkshopAvailableBands(
                          n,
                          newBands.length > 0 ? newBands : [ALL_BAND_IDS.find(id => id !== bandId)]
                        );
                      }}
                      onTeacherChange={updateWorkshopTeacher}
                      onRoomChange={updateWorkshopRoom}
                      onEditPrereqs={handleWorkshopClick}
                      onEditCannotBeParallel={handleCannotBeParallelClick}
                      onArchiveOrDelete={deleteWorkshop}
                      onDuplicate={duplicateWorkshop}
                      onRequestRename={requestRenameWorkshop}
                      onClose={() => setActiveWorkshopEditor(null)}
                    />
                  ) : (
                    <WorkshopDetailEditor
                      key={activeWorkshopEditor.name}
                      name={activeWorkshopEditor.name}
                      isArchived
                      archivedMeta={archivedWorkshops[activeWorkshopEditor.name]}
                      workshopColors={workshopColors}
                      workshopTeachers={workshopTeachers}
                      workshopRooms={workshopRooms}
                      prereqs={prereqs}
                      cannotBeParallel={cannotBeParallel}
                      onColorChange={updateWorkshopColor}
                      onTeacherChange={updateWorkshopTeacher}
                      onRoomChange={updateWorkshopRoom}
                      onReactivate={reactivateWorkshop}
                      onPermanentDelete={permanentlyDeleteArchivedWorkshop}
                      onRequestRename={requestRenameWorkshop}
                      onClose={() => setActiveWorkshopEditor(null)}
                    />
                  )}
                </div>
              </main>
            </div>
          </div>
        </section>
      )}

      {tab === 'rules' && (
        <section className="section flex flex-col min-h-[calc(100vh-10rem)]">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-200 flex flex-col flex-1 min-h-[32rem] overflow-hidden">
            <div className="grid grid-cols-1 xl:grid-cols-5 flex-1 min-h-0">
              <aside className="xl:col-span-2 flex flex-col min-h-[22rem] xl:min-h-0 border-b xl:border-b-0 xl:border-r border-gray-200 bg-gradient-to-b from-purple-50/80 to-violet-50/40">
                <div className="px-5 py-4 border-b border-purple-200/80 shrink-0 space-y-3">
                  <div>
                    <h3 className="text-lg font-semibold text-purple-900">Aktuelle Regeln</h3>
                    <p className="text-xs text-purple-800/70 mt-1">{rules.length} Regel{rules.length === 1 ? '' : 'n'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveRuleEditor('new')}
                    className="w-full px-4 py-2.5 rounded-lg font-semibold text-sm bg-purple-600 text-white hover:bg-purple-700 shadow-sm transition-colors"
                  >
                    + Neue Regel
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
                  {rules.length === 0 && (
                    <div className="text-gray-500 italic p-6 bg-white/70 rounded-xl text-center border border-dashed border-purple-200 text-sm">
                      Noch keine Regeln. Oben „Neue Regel“ wählen.
                    </div>
                  )}
                  {rules.map(r => {
                    const ruleType = r.type || "belegung";
                    const isActive = activeRuleEditor === r.id;
                    const badgeClass =
                      ruleType === 'folgekurs' ? 'bg-green-100 text-green-700'
                      : ruleType === 'mindestbelegung' ? 'bg-indigo-100 text-indigo-700'
                      : ruleType === 'freitext' ? 'bg-amber-100 text-amber-800'
                      : 'bg-purple-100 text-purple-700';
                    return (
                      <div
                        key={r.id}
                        className={`flex rounded-xl border overflow-hidden transition-all ${
                          isActive
                            ? 'bg-white border-purple-400 ring-2 ring-purple-200 shadow-md'
                            : 'bg-white/90 border-gray-200/90 hover:border-purple-200 hover:shadow-sm'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveRuleEditor(r.id)}
                          className="flex-1 min-w-0 text-left p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold text-gray-800 truncate">{r.name || 'Ohne Name'}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badgeClass}`}>
                              {getRuleTypeLabel(ruleType)}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 truncate">{formatRuleZeitraumLabel(r)}</p>
                        </button>
                        <button
                          type="button"
                          title="Regel duplizieren (Kopie zum Bearbeiten)"
                          onClick={() => duplicateRule(r.id)}
                          className="shrink-0 px-3 border-l border-gray-200/80 text-xs font-semibold text-purple-700 hover:bg-purple-50 transition-colors"
                        >
                          Duplizieren
                        </button>
                      </div>
                    );
                  })}
                </div>
              </aside>
              <main className="xl:col-span-3 flex flex-col min-h-[28rem] xl:min-h-0 bg-gradient-to-br from-orange-50/90 to-amber-50/50">
                <div className="px-6 py-4 border-b border-orange-200/80 shrink-0">
                  <h3 className="text-lg font-semibold text-orange-900">
                    {activeRuleEditor === 'new'
                      ? 'Neue Regel erstellen'
                      : activeRuleEditor != null
                        ? 'Regel bearbeiten'
                        : 'Regel-Editor'}
                  </h3>
                  <p className="text-xs text-orange-900/70 mt-1">
                    {activeRuleEditor == null
                      ? 'Links eine Regel wählen oder „Neue Regel“ starten'
                      : activeRuleEditor === 'new'
                        ? 'Typ, Zeitraum und Kurse festlegen'
                        : 'Typ ist fest · Zeitraum und Inhalte anpassen'}
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
                  {activeRuleEditor == null ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[16rem] text-center text-gray-500 px-4">
                      <p className="text-sm max-w-sm">
                        Wählen Sie links eine Belegungs-Regel zum Bearbeiten, oder klicken Sie auf <strong>+ Neue Regel</strong>.
                      </p>
                    </div>
                  ) : activeRuleEditor !== 'new' && !rules.some(r => r.id === activeRuleEditor) ? (
                    <div className="text-sm text-gray-600">
                      Diese Regel existiert nicht mehr.{' '}
                      <button type="button" className="text-purple-700 underline" onClick={() => setActiveRuleEditor(null)}>
                        Schließen
                      </button>
                    </div>
                  ) : (
                    <RuleEditorForm
                      key={activeRuleEditor === 'new' ? 'create' : String(activeRuleEditor)}
                      mode={activeRuleEditor === 'new' ? 'create' : 'edit'}
                      initialRule={
                        activeRuleEditor === 'new'
                          ? null
                          : rules.find(r => r.id === activeRuleEditor)
                      }
                      workshops={Object.keys(workshops)}
                      klassenStufenPool={klassenStufenPool}
                      onAddKlassenStufe={addKlassenStufeToPool}
                      onSave={(payload) => {
                        if (activeRuleEditor === 'new') {
                          const id = addRule(payload);
                          setActiveRuleEditor(id);
                        } else {
                          updateRule(activeRuleEditor, payload);
                        }
                      }}
                      onCancel={() => setActiveRuleEditor(null)}
                      onDelete={
                        activeRuleEditor !== 'new'
                          ? () => {
                              if (window.confirm('Diese Regel wirklich löschen?')) {
                                deleteRule(activeRuleEditor);
                              }
                            }
                          : undefined
                      }
                      onDuplicate={
                        activeRuleEditor !== 'new'
                          ? () => duplicateRule(activeRuleEditor)
                          : undefined
                      }
                    />
                  )}
                </div>
              </main>
            </div>
          </div>
        </section>
      )}

      <Dialog open={!!workshopRenameDialog} onOpenChange={(open) => { if (!open) setWorkshopRenameDialog(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Werkstatt umbenennen</DialogTitle>
          </DialogHeader>
          {workshopRenameDialog && (
            <div className="space-y-4 py-2 text-sm text-gray-700">
              <p>
                <strong>„{workshopRenameDialog.oldName}“</strong> wird in{' '}
                <strong>„{workshopRenameDialog.newName}“</strong> umbenannt.
              </p>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
                <p className="font-semibold">Achtung: Historische Daten werden angepasst</p>
                <p className="mt-2">
                  Der neue Name ersetzt den alten überall — in Zuordnungen aller Trimester, Wahl-Uploads,
                  Regeln, Voraussetzungen, Trimester-Plänen und Archiv-Einträgen. Dies kann nicht rückgängig
                  gemacht werden.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWorkshopRenameDialog(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={confirmRenameWorkshop}
                  className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
                >
                  Umbenennen bestätigen
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Prerequisites Dialog */}
      {showPrereqDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-gray-800 mb-4 border-b border-gray-300 pb-3">
              Voraussetzungen bearbeiten – {editingWorkshop}
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto mb-6">
              {Object.keys(workshops)
                .filter((w) => w !== editingWorkshop)
                .map((w) => (
                  <div key={w} className="flex items-center p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg hover:from-gray-100 hover:to-gray-200 transition-all duration-200">
                    <input
                      type="checkbox"
                      checked={tempPrereqs.includes(w)}
                      onChange={() => toggleTempPrereq(w)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label className="ml-3 text-sm font-medium text-gray-700 cursor-pointer">{w}</label>
                  </div>
                ))}
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowPrereqDialog(false)} 
                className="flex-1 px-4 py-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-medium rounded-lg shadow-sm hover:from-gray-600 hover:to-gray-700 hover:shadow-md transition-all duration-200"
              >
                Abbrechen
              </button>
              <button 
                onClick={saveWorkshopPrereqs} 
                className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-medium rounded-lg shadow-sm hover:from-blue-600 hover:to-blue-700 hover:shadow-md transition-all duration-200"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {showCannotBeParallelDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold text-gray-800 mb-4 border-b border-gray-300 pb-3">
              Nicht parallel belegbar bearbeiten – {editingWorkshop}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Wählen Sie Werkstätten, die nicht parallel zu dieser Werkstatt im anderen Band belegt werden können.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto mb-6">
              {Object.keys(workshops)
                .filter((w) => w !== editingWorkshop)
                .map((w) => (
                  <div key={w} className="flex items-center p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg hover:from-gray-100 hover:to-gray-200 transition-all duration-200">
                    <input
                      type="checkbox"
                      checked={tempCannotBeParallel.includes(w)}
                      onChange={() => toggleTempCannotBeParallel(w)}
                      className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500"
                    />
                    <label className="ml-3 text-sm font-medium text-gray-700 cursor-pointer">{w}</label>
                  </div>
                ))}
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCannotBeParallelDialog(false)} 
                className="flex-1 px-4 py-2 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-medium rounded-lg shadow-sm hover:from-gray-600 hover:to-gray-700 hover:shadow-md transition-all duration-200"
              >
                Abbrechen
              </button>
              <button 
                onClick={saveWorkshopCannotBeParallel} 
                className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-medium rounded-lg shadow-sm hover:from-orange-600 hover:to-orange-700 hover:shadow-md transition-all duration-200"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

            {/* Column Mapping & Preview Modal for Student Votes Upload */}
      <ColumnMappingModal
        isOpen={columnMappingModal.isOpen}
        onClose={() => setColumnMappingModal((prev) => ({ ...prev, isOpen: false }))}
        fileName={columnMappingModal.fileName}
        targetBand={columnMappingModal.targetBand}
        onTargetBandChange={(newBand) => setColumnMappingModal((prev) => ({ ...prev, targetBand: newBand }))}
        activeBandIds={activeBandIds}
        getBandLabel={getBandLabel}
        headers={columnMappingModal.headers}
        previewRows={columnMappingModal.previewRows}
        totalRows={columnMappingModal.totalRows}
        mappings={columnMappingModal.mappings}
        onMappingChange={handleColumnMappingChange}
        onResetMappings={handleResetColumnMappings}
        onConfirm={handleConfirmColumnMapping}
      />

      <footer className="app-footer">2026 Jasper Wilfling</footer>

    </div>
  );
}

// ----------------------------
// Subcomponents
// ----------------------------
function WorkshopDetailEditor({
  name,
  isArchived,
  workshop,
  archivedMeta,
  workshopColors,
  workshopTeachers,
  workshopRooms,
  prereqs,
  cannotBeParallel,
  allowSelfParallel = {},
  onToggleSelfParallel,
  onColorChange,
  onCapacityChange,
  onBandToggle,
  onTeacherChange,
  onRoomChange,
  onEditPrereqs,
  onEditCannotBeParallel,
  onArchiveOrDelete,
  onDuplicate,
  onRequestRename,
  onReactivate,
  onPermanentDelete,
  onClose,
}) {
  const [nameDraft, setNameDraft] = React.useState(name);
  React.useEffect(() => {
    setNameDraft(name);
  }, [name]);

  const cap = isArchived
    ? archivedMeta?.capacity ?? 0
    : getWorkshopCapacity(workshop, name);
  const availableBands = isArchived
    ? archivedMeta?.availableBands || ALL_BAND_IDS
    : getWorkshopAvailableBands(workshop, name);

  const trimmedDraft = nameDraft.trim();
  const canSubmitRename = trimmedDraft.length > 0 && trimmedDraft !== name;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Name der Werkstatt</label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              className="flex-1 min-w-[10rem] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-base font-semibold text-gray-900"
            />
            {onRequestRename && (
              <button
                type="button"
                disabled={!canSubmitRename}
                onClick={() => onRequestRename(name, trimmedDraft)}
                className="px-3 py-2 text-sm font-semibold rounded-lg border border-blue-200 text-blue-800 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Name ändern…
              </button>
            )}
          </div>
          {isArchived && archivedMeta?.archivedAt && (
            <p className="text-xs text-gray-500 mt-1">
              Archiviert am {new Date(archivedMeta.archivedAt).toLocaleDateString('de-DE')}
            </p>
          )}
        </div>
        <ColorPicker
          currentColor={workshopColors[name] || ''}
          usedColors={Object.values(workshopColors)}
          allWorkshopColors={workshopColors}
          onColorChange={color => onColorChange(name, color)}
        />
      </div>

      {!isArchived && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Kapazität</label>
          <input
            type="number"
            min={0}
            value={cap}
            onChange={e => onCapacityChange(name, e.target.value)}
            className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
      )}

      {isArchived && (
        <p className="text-sm text-gray-600">
          Kapazität (Archiv): <span className="font-semibold">{cap}</span>
        </p>
      )}

      {!isArchived && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Verfügbar in Bändern</label>
          <div className="flex flex-wrap gap-3 p-3 bg-white rounded-lg border border-gray-200">
            {BANDS.map(band => (
              <label key={band.id} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={availableBands.includes(band.id)}
                  onChange={e => onBandToggle(name, band.id, e.target.checked, availableBands)}
                  className="w-4 h-4 text-blue-600"
                />
                <span>{band.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Lehrkraft</label>
        <input
          type="text"
          value={workshopTeachers[name] || ''}
          onChange={e => onTeacherChange(name, e.target.value)}
          placeholder="Name der Lehrkraft"
          disabled={isArchived}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Raum</label>
        <input
          type="text"
          value={workshopRooms[name] || ''}
          onChange={e => onRoomChange(name, e.target.value)}
          placeholder="Raumnummer"
          disabled={isArchived}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm disabled:bg-gray-100"
        />
      </div>

      {(prereqs[name]?.length > 0 || !isArchived) && (
        <div className="text-sm text-gray-700 p-3 bg-white rounded-lg border border-gray-200">
          <span className="font-medium">Voraussetzungen:</span>{' '}
          {prereqs[name]?.length ? (
            <span className="text-orange-700">{prereqs[name].join(', ')}</span>
          ) : (
            <span className="text-gray-400 italic">Keine</span>
          )}
          {!isArchived && (
            <button
              type="button"
              onClick={() => onEditPrereqs(name)}
              className="block mt-2 text-sm font-medium text-green-700 hover:text-green-800"
            >
              Voraussetzungen bearbeiten
            </button>
          )}
        </div>
      )}

      {!isArchived && (
        <label className="flex items-start gap-3 text-sm text-gray-800 p-3 bg-white rounded-lg border border-gray-200 cursor-pointer">
          <input
            type="checkbox"
            checked={allowSelfParallel[name] !== true}
            onChange={event => onToggleSelfParallel?.(name, !event.target.checked)}
            className="mt-0.5 w-4 h-4 text-orange-600"
          />
          <span>
            <span className="font-medium">Nicht parallel zu sich selbst in einem anderen Band</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Standardmäßig aktiv. Ein Schüler soll diesen Kurs nicht gleichzeitig in einem zweiten Band belegen.
            </span>
          </span>
        </label>
      )}

      {(cannotBeParallel[name]?.length > 0 || !isArchived) && (
        <div className="text-sm text-gray-700 p-3 bg-white rounded-lg border border-gray-200">
          <span className="font-medium">Nicht parallel mit:</span>{' '}
          {cannotBeParallel[name]?.length ? (
            <span className="text-red-700">{cannotBeParallel[name].join(', ')}</span>
          ) : (
            <span className="text-gray-400 italic">Keine</span>
          )}
          {!isArchived && (
            <button
              type="button"
              onClick={() => onEditCannotBeParallel(name)}
              className="block mt-2 text-sm font-medium text-orange-700 hover:text-orange-800"
            >
              Parallel-Regeln bearbeiten
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50"
          >
            Schließen
          </button>
        )}
        {!isArchived && (onDuplicate || onArchiveOrDelete) && (
          <div className="flex flex-1 flex-col sm:flex-row gap-2 min-w-0">
            {onDuplicate && (
              <button
                type="button"
                onClick={() => onDuplicate(name)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-blue-50 text-blue-800 font-medium border border-blue-200 hover:bg-blue-100"
              >
                Duplizieren
              </button>
            )}
            {onArchiveOrDelete && (
              <button
                type="button"
                onClick={() => onArchiveOrDelete(name)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-50 text-red-700 font-medium border border-red-200 hover:bg-red-100"
              >
                Löschen / Archivieren
              </button>
            )}
          </div>
        )}
        {isArchived && onReactivate && (
          <button
            type="button"
            onClick={() => onReactivate(name)}
            className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
          >
            Reaktivieren
          </button>
        )}
        {isArchived && onPermanentDelete && (
          <button
            type="button"
            onClick={() => onPermanentDelete(name)}
            className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
          >
            Endgültig löschen
          </button>
        )}
      </div>
    </div>
  );
}

function AddWorkshopForm({ onAdd }) {
  const [name, setName] = useState("");
  const [cap, setCap] = useState(16);
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Name der Werkstatt</label>
        <input 
          placeholder="Name" 
          value={name} 
          onChange={e=>setName(e.target.value)} 
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200" 
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Kapazität</label>
        <input 
          type="number" 
          placeholder="Kapazität" 
          value={cap} 
          onChange={e=>setCap(Number(e.target.value))} 
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200" 
        />
      </div>
      <button 
        onClick={()=>{onAdd(name,cap); setName(""); setCap(16);}} 
        className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200"
      >
        Werkstatt hinzufügen
      </button>
    </div>
  );
}

function KlassenStufenRangeSlider({ pool, rangeFrom, rangeTo, onChange, onAddStufe }) {
  const cellRefs = useRef([]);
  const dragEdgeRef = useRef(null);

  const fromIdx = Math.max(0, pool.indexOf(rangeFrom));
  const toIdx = Math.max(fromIdx, pool.indexOf(rangeTo));

  const clampedFrom = pool[fromIdx];
  const clampedTo = pool[toIdx];

  function poolIndexFromClientX(clientX) {
    for (let i = 0; i < pool.length; i++) {
      const el = cellRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return pool.length - 1;
  }

  useEffect(() => {
    function onPointerMove(e) {
      const edge = dragEdgeRef.current;
      if (!edge) return;
      const idx = poolIndexFromClientX(e.clientX);
      if (edge === 'left') {
        const newFrom = pool[Math.min(idx, toIdx)];
        const newTo = pool[toIdx];
        onChange(newFrom, newTo);
      } else {
        const newFrom = pool[fromIdx];
        const newTo = pool[Math.max(idx, fromIdx)];
        onChange(newFrom, newTo);
      }
    }
    function onPointerUp() {
      dragEdgeRef.current = null;
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [pool, fromIdx, toIdx, onChange]);

  function startDrag(edge, e) {
    e.preventDefault();
    dragEdgeRef.current = edge;
  }

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
      <label className="block text-sm font-medium text-teal-900 mb-1">Zeitraum (Jahrgangsstufen)</label>
      <p className="text-xs text-teal-800/80 mb-3">
        Regel muss in diesem Stufen-Bereich erfüllt sein (Klasse „5a“ → Stufe&nbsp;5). An den grünen Rändern ziehen, um den Zeitraum zu verkleinern oder zu vergrößern. Mit „+“ höhere Stufen einblenden.
      </p>
      <div className="flex flex-wrap items-stretch gap-0.5 select-none touch-none">
        {pool.map((stufe, i) => {
          const inRange = i >= fromIdx && i <= toIdx;
          const isLeftEdge = i === fromIdx;
          const isRightEdge = i === toIdx;
          return (
            <div
              key={stufe}
              ref={el => { cellRefs.current[i] = el; }}
              className="relative flex items-stretch"
            >
              {isLeftEdge && (
                <button
                  type="button"
                  aria-label="Untergrenze verschieben"
                  onPointerDown={e => startDrag('left', e)}
                  className="w-2 shrink-0 cursor-ew-resize rounded-l-md bg-teal-800 hover:bg-teal-900 border border-teal-900"
                />
              )}
              <div
                className={`min-w-[2.75rem] px-2 py-2.5 text-center text-sm font-semibold border-y border-teal-300 ${
                  inRange
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-gray-700 border-gray-200'
                } ${!isLeftEdge && i === fromIdx + 0 ? '' : ''} ${isLeftEdge ? 'border-l-0' : 'border-l'} ${isRightEdge ? 'border-r-0' : 'border-r'}`}
              >
                {stufe}
              </div>
              {isRightEdge && (
                <button
                  type="button"
                  aria-label="Obergrenze verschieben"
                  onPointerDown={e => startDrag('right', e)}
                  className="w-2 shrink-0 cursor-ew-resize rounded-r-md bg-teal-800 hover:bg-teal-900 border border-teal-900"
                />
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAddStufe}
          title="Nächste Stufe zur Liste hinzufügen"
          className="ml-2 min-w-[2.5rem] h-[2.75rem] self-center flex items-center justify-center rounded-lg border-2 border-dashed border-teal-500 text-teal-700 font-bold text-lg hover:bg-teal-100/80"
        >
          +
        </button>
      </div>
      <p className="text-xs text-teal-900 mt-2 font-medium">
        Ausgewählt: Stufe {clampedFrom}–{clampedTo}
      </p>
    </div>
  );
}

function EinschulungsjahrgangRuleFields({ yearFrom, yearTo, onChangeFrom, onChangeTo }) {
  const years = useMemo(() => getEinschulungsjahrYearOptions(), []);
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <label className="block text-sm font-medium text-indigo-900 mb-1">Einschulungsjahrgang</label>
      <p className="text-xs text-indigo-900/70 mb-3">
        Gilt für Schüler, deren hinterlegtes Einschulungsjahr im gewählten Bereich liegt (z.&nbsp;B. ab 2024 bis 2026).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Frühestens (ab Einschulung)</label>
          <select
            value={yearFrom ?? ''}
            onChange={e => onChangeFrom(e.target.value === '' ? null : Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">Ohne Untergrenze</option>
            {years.map(y => (
              <option key={`ef-${y}`} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Spätestens (bis Einschulung)</label>
          <select
            value={yearTo ?? ''}
            onChange={e => onChangeTo(e.target.value === '' ? null : Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">Ohne Obergrenze</option>
            {years.map(y => (
              <option key={`et-${y}`} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function getInitialRuleFormState(initialRule, klassenStufenPool) {
  const range = initialRule ? getRuleKlassenStufenRange(initialRule) : null;
  return {
    ruleType: initialRule?.type || 'belegung',
    name: initialRule?.name || '',
    selected: [...(initialRule?.options || [])],
    rangeFrom: range?.from ?? klassenStufenPool[0] ?? 5,
    rangeTo: range?.to ?? klassenStufenPool[klassenStufenPool.length - 1] ?? 10,
    einschulFrom: initialRule?.einschulungsjahrFrom ?? null,
    einschulTo: initialRule?.einschulungsjahrTo ?? null,
    minCount: initialRule?.minCount ?? 3,
    freeTextDescription: initialRule?.description || '',
    fromCourse: initialRule?.fromCourse || '',
    toCourse: initialRule?.toCourse || '',
    sameBand: !!initialRule?.sameBand,
  };
}

function RuleEditorForm({
  mode,
  initialRule,
  workshops,
  klassenStufenPool,
  onAddKlassenStufe,
  onSave,
  onCancel,
  onDelete,
  onDuplicate,
}) {
  const isEdit = mode === 'edit';
  const sameBandInputId = useId();
  const init = getInitialRuleFormState(initialRule, klassenStufenPool);

  const [ruleType, setRuleType] = useState(init.ruleType);
  const [name, setName] = useState(init.name);
  const [selected, setSelected] = useState(init.selected);
  const [rangeFrom, setRangeFrom] = useState(init.rangeFrom);
  const [rangeTo, setRangeTo] = useState(init.rangeTo);
  const [einschulFrom, setEinschulFrom] = useState(init.einschulFrom);
  const [einschulTo, setEinschulTo] = useState(init.einschulTo);
  const [minCount, setMinCount] = useState(init.minCount);
  const [freeTextDescription, setFreeTextDescription] = useState(init.freeTextDescription);
  const [fromCourse, setFromCourse] = useState(init.fromCourse);
  const [toCourse, setToCourse] = useState(init.toCourse);
  const [sameBand, setSameBand] = useState(init.sameBand);

  const sortedWorkshops = useMemo(
    () => [...workshops].sort((a, b) => a.localeCompare(b, 'de')),
    [workshops]
  );

  useEffect(() => {
    if (klassenStufenPool.length === 0) return;
    setRangeFrom(prev => (klassenStufenPool.includes(prev) ? prev : klassenStufenPool[0]));
    setRangeTo(prev => (klassenStufenPool.includes(prev) ? prev : klassenStufenPool[klassenStufenPool.length - 1]));
  }, [klassenStufenPool]);

  function toggleOpt(opt) {
    setSelected(prev => prev.includes(opt) ? prev.filter(x=>x!==opt) : [...prev, opt]);
  }

  function handleRangeChange(from, to) {
    setRangeFrom(from);
    setRangeTo(to);
  }

  function zeitraumMeta() {
    const from = Math.min(rangeFrom, rangeTo);
    const to = Math.max(rangeFrom, rangeTo);
    return { klassenStufenRange: { from, to } };
  }

  function cohortMeta() {
    return {
      einschulungsjahrFrom: einschulFrom,
      einschulungsjahrTo: einschulTo,
    };
  }

  function buildPayload() {
    const base = { type: ruleType, name, ...zeitraumMeta(), ...cohortMeta() };
    if (ruleType === 'belegung') {
      return { ...base, options: selected };
    }
    if (ruleType === 'mindestbelegung') {
      const required = Math.max(1, parseInt(String(minCount), 10) || 1);
      return { ...base, options: selected, minCount: required };
    }
    if (ruleType === 'freitext') {
      return { ...base, description: freeTextDescription.trim() };
    }
    if (ruleType === 'folgekurs') {
      return { ...base, fromCourse, toCourse, sameBand };
    }
    return base;
  }

  function submit() {
    if (!name) {
      alert('Bitte einen Regel-Namen eingeben.');
      return;
    }
    if (einschulFrom != null && einschulTo != null && einschulFrom > einschulTo) {
      alert('Einschulungsjahr „frühestens“ darf nicht nach „spätestens“ liegen.');
      return;
    }
    
    if (ruleType === "belegung") {
      if (selected.length === 0) {
        alert('Bitte mindestens einen Kurs wählen.');
        return;
      }
    } else if (ruleType === "mindestbelegung") {
      if (selected.length === 0) {
        alert('Bitte mindestens einen Kurs für die Auswahl wählen.');
        return;
      }
      const required = Math.max(1, parseInt(String(minCount), 10) || 1);
      if (required > selected.length) {
        alert(`Die Mindestanzahl (${required}) kann nicht größer sein als die Anzahl gewählter Kurse (${selected.length}).`);
        return;
      }
    } else if (ruleType === "freitext") {
      if (!freeTextDescription.trim()) {
        alert('Bitte einen Regeltext eingeben.');
        return;
      }
    } else if (ruleType === "folgekurs") {
      if (!fromCourse || !toCourse) {
        alert('Bitte sowohl Ausgangskurs als auch Folgekurs auswählen.');
        return;
      }
    }
    onSave(buildPayload());
  }

  const showWorkshopPicker = ruleType === 'belegung' || ruleType === 'mindestbelegung';

  return (
    <div className="space-y-5 max-w-3xl">
      <KlassenStufenRangeSlider
        pool={klassenStufenPool}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        onChange={handleRangeChange}
        onAddStufe={onAddKlassenStufe}
      />
      <EinschulungsjahrgangRuleFields
        yearFrom={einschulFrom}
        yearTo={einschulTo}
        onChangeFrom={setEinschulFrom}
        onChangeTo={setEinschulTo}
      />
      {isEdit ? (
        <div className="px-4 py-3 rounded-lg border border-gray-200 bg-white/80">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Regel-Typ</span>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">{getRuleTypeLabel(ruleType)}</p>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Regel-Typ</label>
          <select 
            value={ruleType} 
            onChange={e => { setRuleType(e.target.value); setSelected([]); }}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
          >
            <option value="belegung">Alle ausgewählten Kurse (jeder mindestens 1×)</option>
            <option value="mindestbelegung">Mindestanzahl aus Kurs-Pool</option>
            <option value="folgekurs">Folgekurs-Regel</option>
            <option value="freitext">Freitext / manuelle Checkliste</option>
          </select>
        </div>
      )}
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Regel-Name</label>
        <input 
          placeholder="Regel-Name" 
          value={name} 
          onChange={e=>setName(e.target.value)} 
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200" 
        />
      </div>

      {ruleType === "mindestbelegung" && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Mindestanzahl verschiedener Kurse</label>
          <input
            type="number"
            min={1}
            max={99}
            value={minCount}
            onChange={e => setMinCount(e.target.value)}
            className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">z. B. 3 Kunst-Kurse aus dem unten gewählten Pool.</p>
        </div>
      )}

      {ruleType === "freitext" && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Regeltext (erscheint bei jedem Schüler)</label>
          <textarea
            value={freeTextDescription}
            onChange={e => setFreeTextDescription(e.target.value)}
            rows={4}
            placeholder="z. B. Elterngespräch zur Werkstattwahl geführt …"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-sm resize-y"
          />
          <p className="text-xs text-gray-500 mt-1">In der Schülerübersicht kann diese Regel pro Schüler manuell abgehakt werden.</p>
        </div>
      )}

      {showWorkshopPicker ? (
        <>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <label className="text-sm font-medium text-gray-700">
                Kurse für diese Regel ({selected.length}/{sortedWorkshops.length})
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelected([...sortedWorkshops])} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">
                  Alle auswählen
                </button>
                <button type="button" onClick={() => setSelected([])} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">
                  Auswahl leeren
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[min(20rem,calc(100vh-22rem))] overflow-y-auto pr-1">
              {sortedWorkshops.map(w => (
                <div key={w} className="flex items-center p-2 bg-white rounded-lg border border-gray-200 hover:bg-gray-50 transition-all duration-200">
                  <input 
                    type="checkbox" 
                    checked={selected.includes(w)} 
                    onChange={()=>toggleOpt(w)}
                    className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500"
                  />
                  <label className="ml-2 text-sm font-medium text-gray-700 cursor-pointer">{w}</label>
                </div>
              ))}
            </div>
          </div>
          {ruleType === "belegung" && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3">
              Der Schüler muss <strong>jeden</strong> ausgewählten Kurs mindestens einmal in der Historie belegt haben.
            </p>
          )}
          {ruleType === "mindestbelegung" && (
            <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              Es zählen <strong>verschiedene</strong> Kurse aus der Auswahl (z. B. 3 von 10 Kunst-Werkstätten).
            </p>
          )}
        </>
      ) : ruleType === "folgekurs" ? (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ausgangskurs (wenn Schüler diesen Kurs belegt):</label>
            <select 
              value={fromCourse} 
              onChange={e=>setFromCourse(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
            >
              <option value="">-- Ausgangskurs wählen --</option>
              {sortedWorkshops.map(w => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Folgekurs (muss im nächsten Trimester belegt werden):</label>
            <select 
              value={toCourse} 
              onChange={e=>setToCourse(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
            >
              <option value="">-- Folgekurs wählen --</option>
              {sortedWorkshops.map(w => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center p-3 bg-white rounded-lg border border-gray-200">
            <input 
              type="checkbox" 
              id={sameBandInputId}
              checked={sameBand} 
              onChange={e=>setSameBand(e.target.checked)}
              className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500"
            />
            <label htmlFor={sameBandInputId} className="ml-2 text-sm font-medium text-gray-700 cursor-pointer">
              Folgekurs muss im gleichen Band sein wie der Ausgangskurs
            </label>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-xs text-blue-700">
                <strong>Hinweis:</strong> Wenn ein Schüler den Ausgangskurs in einem Trimester belegt, muss er im nächsten Trimester automatisch den Folgekurs belegen. Der Folgekurs kann derselbe Kurs sein (z.B. Kurs A → Kurs A). Wenn "gleiches Band" aktiviert ist, muss der Folgekurs im selben Band (Erstes oder Zweites Band) wie der Ausgangskurs sein.
              </div>
            </div>
          </div>
        </>
      ) : null}
      
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button 
          type="button"
          onClick={submit} 
          className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-lg shadow-sm hover:from-orange-600 hover:to-orange-700 hover:shadow-md transition-all duration-200"
        >
          {isEdit ? 'Änderungen speichern' : 'Regel erstellen'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50"
          >
            Schließen
          </button>
        )}
      </div>
      {isEdit && (onDuplicate || onDelete) && (
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          {onDuplicate && (
            <button
              type="button"
              onClick={onDuplicate}
              className="flex-1 px-4 py-2 text-sm font-medium text-purple-800 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100"
            >
              Regel duplizieren
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex-1 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
            >
              Regel löschen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// NEW: StudentHistoryTable – shows confirmedAssignments for a given student and allows inline edit
function StudentHistoryTable({ student, confirmedAssignments, workshops, onChangeAssignment, archivedWorkshops = {} }) {
  const slots = Object.entries(confirmedAssignments).map(([slotKey, payload]) => {
    if (isMultiBandPayload(payload)) {
      const bandIds = getPayloadBandIds(payload);
      const bandAssignments = {};
      bandIds.forEach(bandId => {
        bandAssignments[bandId] = payload.assignments[bandId]?.[student] || 'Nicht Zugeordnet';
      });
      return { slotKey, timestamp: payload.timestamp, bandIds, bandAssignments, isMultiBand: true };
    }
    return {
      slotKey,
      timestamp: payload.timestamp,
      assigned: payload.assignments?.[student] || 'Nicht Zugeordnet',
      isMultiBand: false,
    };
  });

  slots.sort((a, b) => (a.slotKey < b.slotKey ? 1 : -1));

  const displayBandIds = ALL_BAND_IDS.slice(
    0,
    Math.max(DEFAULT_BAND_COUNT, ...slots.filter(s => s.isMultiBand).map(s => s.bandIds.length))
  );

  if (slots.length === 0) return (
    <div className="text-gray-500 italic p-4 bg-gray-50 rounded-lg text-center">
      Keine historischen Zuordnungen verfügbar.
    </div>
  );

  const renderAssignmentBadge = (workshop) => (
    <div className="flex items-center gap-2">
      <div className={`px-2 py-1 rounded text-xs font-medium ${
        workshop === 'Nicht Zugeordnet' ? 'bg-gray-100 text-gray-600' :
        archivedWorkshops[workshop] ? 'bg-gray-200 text-gray-700 opacity-75' :
        'bg-blue-100 text-blue-800'
      }`}>
        {workshop}
      </div>
      {archivedWorkshops[workshop] && (
        <span className="text-xs text-gray-500" title="Archivierte Werkstatt">📦</span>
      )}
    </div>
  );

  return (
    <div className="overflow-auto bg-white rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-800 border-b border-gray-200">Jahr-Trimester</th>
            {displayBandIds.map(bandId => (
              <th key={bandId} className="px-4 py-3 text-left font-semibold text-gray-800 border-b border-gray-200">{getBandLabel(bandId)}</th>
            ))}
            <th className="px-4 py-3 text-left font-semibold text-gray-800 border-b border-gray-200">Bearbeiten</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-800 border-b border-gray-200">Letzte Änderung</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s, index) => (
            <tr key={s.slotKey} className={`hover:bg-gray-50 transition-colors duration-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-25'}`}>
              <td className="px-4 py-3 border-b border-gray-100">
                <div className="font-semibold text-blue-700">{s.slotKey}</div>
              </td>
              {displayBandIds.map(bandId => (
                <td key={bandId} className="px-4 py-3 border-b border-gray-100">
                  {s.isMultiBand ? (
                    renderAssignmentBadge(s.bandAssignments[bandId] || 'Nicht Zugeordnet')
                  ) : (
                    bandId === displayBandIds[0]
                      ? renderAssignmentBadge(s.assigned)
                      : <div className="text-gray-400 text-xs">—</div>
                  )}
                </td>
              ))}
              <td className="px-4 py-3 border-b border-gray-100">
                {s.isMultiBand ? (
                  <div className="space-y-2">
                    {s.bandIds.map(bandId => (
                      <div key={bandId}>
                        <div className="text-xs text-gray-600 mb-1 font-medium">{getBandLabel(bandId)}:</div>
                        <select
                          value={s.bandAssignments[bandId]}
                          onChange={(e) => onChangeAssignment(s.slotKey, student, e.target.value, bandId)}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                        >
                          <option value="Nicht Zugeordnet">Nicht Zugeordnet</option>
                          {workshops.map(w => (
                            <option key={w} value={w}>{w}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                ) : (
                  <select
                    value={s.assigned}
                    onChange={(e) => onChangeAssignment(s.slotKey, student, e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  >
                    <option value="Nicht Zugeordnet">Nicht Zugeordnet</option>
                    {workshops.map(w => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                )}
              </td>
              <td className="px-4 py-3 border-b border-gray-100 text-xs text-gray-500">
                {s.timestamp ? new Date(s.timestamp).toLocaleString() : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ColorPicker component for workshop colors
function ColorPicker({ currentColor, usedColors, allWorkshopColors = {}, onColorChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputColor, setInputColor] = useState(currentColor);
  
  // Predefined palette of nice colors
  const palette = [
    '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6',
    '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#A855F7',
    '#06B6D4', '#84CC16', '#FBBF24', '#F43F5E', '#6366F1',
    '#BE185D', '#059669', '#DC2626', '#7C3AED', '#0891B2'
  ];
  
  // Add used colors to palette
  const availableColors = [...new Set([...palette, ...usedColors])];
  
  useEffect(() => {
    setInputColor(currentColor);
  }, [currentColor]);
  
  const handleColorSelect = (color, e) => {
    if (e) e.stopPropagation();
    onColorChange(color);
    setIsOpen(false);
  };
  
  const handleInputChange = (e) => {
    const color = e.target.value;
    setInputColor(color);
    if (color.match(/^#[0-9A-Fa-f]{6}$/)) {
      onColorChange(color);
    }
  };
  
  return (
    <div className="relative inline-block">
      {/* Color preview - click to open */}
      <div 
        className="w-10 h-10 rounded-lg border-2 border-gray-300 cursor-pointer hover:border-gray-400 transition-all duration-200 shadow-sm"
        style={{ backgroundColor: currentColor || '#E5E7EB' }}
        onClick={() => setIsOpen(!isOpen)}
        title="Klicken zum Ändern der Farbe"
      />
      
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-[9999] bg-black bg-opacity-20" 
            onClick={() => setIsOpen(false)}
          ></div>
          
          {/* Color picker popup - using portal-like positioning */}
          <div className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-none">
            <div 
              className="bg-white rounded-lg shadow-2xl border-2 border-gray-200 p-3 w-64 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="text-xs font-semibold text-gray-700 mb-2">Farbe auswählen</div>
            
            {/* Palette */}
            <div className="grid grid-cols-5 gap-2 mb-3">
              {availableColors.map((color) => {
                const isUsed = usedColors.includes(color);
                const workshopName = isUsed ? Object.entries(allWorkshopColors || {}).find(([_, c]) => c === color)?.[0] : null;
                return (
                  <div
                    key={color}
                    onClick={(e) => handleColorSelect(color, e)}
                    className={`w-8 h-8 rounded cursor-pointer hover:scale-110 transition-transform duration-200 border-2 ${
                      currentColor === color ? 'border-gray-800 ring-2 ring-offset-1' : 'border-gray-300'
                    } ${isUsed && currentColor !== color ? 'ring-1 ring-gray-400' : ''}`}
                    style={{ backgroundColor: color }}
                    title={isUsed && currentColor !== color ? `Bereits verwendet: ${workshopName || 'unbekannt'}` : 'Klicken zum Auswählen'}
                  />
                );
              })}
            </div>
            
            {/* Custom color input */}
            <div className="mb-2">
              <div className="text-xs text-gray-600 mb-1">Eigene Farbe:</div>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={inputColor || '#E5E7EB'}
                  onChange={handleInputChange}
                  className="w-12 h-8 rounded cursor-pointer border border-gray-300"
                />
                <input
                  type="text"
                  value={inputColor || ''}
                  onChange={(e) => setInputColor(e.target.value)}
                  onBlur={handleInputChange}
                  placeholder="#HEX"
                  className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            
            {/* Used colors info */}
            {usedColors.length > 0 && (
              <div className="text-xs mt-2 pt-2 border-t border-gray-200">
                <div className="text-gray-600 font-semibold mb-1">Bereits verwendete Farben (anklickbar):</div>
                <div className="flex flex-wrap gap-1">
                  {usedColors.filter(c => c !== currentColor).map((color, idx) => {
                    // Find the workshop name that uses this color
                    const workshopName = Object.entries(allWorkshopColors || {}).find(([_, c]) => c === color)?.[0];
                    return (
                      <div 
                        key={idx} 
                        className="flex items-center gap-1 cursor-pointer hover:bg-gray-100 rounded px-1 py-0.5 transition-colors duration-200"
                        onClick={(e) => handleColorSelect(color, e)}
                        title={`Klicken um diese Farbe zu wählen (${workshopName || 'unbekannt'})`}
                      >
                        <div 
                          className="w-4 h-4 rounded border border-gray-300 hover:border-gray-500 transition-all duration-200"
                          style={{ backgroundColor: color }}
                        />
                        {workshopName && (
                          <span className="text-gray-500 text-[10px] max-w-[60px] truncate">{workshopName}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {usedColors.filter(c => c !== currentColor).length === 0 && (
                  <span className="text-gray-500">Diese Farbe wird noch nicht verwendet</span>
                )}
              </div>
            )}
            </div>
          </div>
        </>
      )}

    </div>
  );
}
