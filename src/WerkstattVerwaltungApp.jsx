import React, { useEffect, useState, useMemo } from "react";
import JSZip from "jszip";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

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
  studentPriorityScores: "wv_studentPriorityScores", // NEW: map student -> priority score (1-10)
  workshopColors: "wv_workshopColors", // NEW: map workshop -> color hex
  studentComments: "wv_studentComments", // NEW: map student -> comment/notes
  workshopTeachers: "wv_workshopTeachers", // NEW: map workshop -> teacher name
  workshopRooms: "wv_workshopRooms", // NEW: map workshop -> room number
  archivedWorkshops: "wv_archivedWorkshops" // NEW: map workshop -> { capacity, archivedAt }
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
               key === 'wv_studentAssistants' || key === 'wv_studentClasses' || key === 'wv_studentPriorityScores' ||
               key === 'wv_workshopColors' || key === 'wv_studentComments' || key === 'wv_workshopTeachers' || key === 'wv_workshopRooms' || key === 'wv_archivedWorkshops') {
      const result = {};
      rows.forEach(row => {
        if (key === 'wv_studentAssistants') {
          result[row[0]] = row[1] === 'Ja' || row[1] === 'true';
        } else if (key === 'wv_studentTrimesters' || key === 'wv_studentPriorityScores' || key === 'wv_studentComments' || 
                   key === 'wv_workshopTeachers' || key === 'wv_workshopRooms') {
          // For comments, teachers, rooms, preserve the value as-is (may contain newlines, semicolons, etc.)
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
          name: row[1] || ''
        };
        
        if (ruleType === 'belegung') {
          return {
            ...baseRule,
            options: row[2] ? row[2].split(',').map(s => s.trim()) : []
          };
        } else if (ruleType === 'folgekurs') {
          return {
            ...baseRule,
            fromCourse: row[3] || '',
            toCourse: row[4] || '',
            sameBand: row[5] === 'true' || row[5] === 'Ja'
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
  'wv_rules': { filename: 'rules.csv', headers: ['RuleType', 'RuleName', 'Options', 'FromCourse', 'ToCourse', 'SameBand'] },
  'wv_studentTrimesters': { filename: 'student-trimesters.csv', headers: ['Student', 'Trimester'] },
  'wv_studentAssistants': { filename: 'student-assistants.csv', headers: ['Student', 'NeedsAssistance'] },
  'wv_studentClasses': { filename: 'student-classes.csv', headers: ['Student', 'Class'] },
  'wv_studentPriorityScores': { filename: 'priority-scores.csv', headers: ['Student', 'PriorityScore'] },
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
            csvData = data.map(item => {
              const ruleType = item.type || 'belegung';
              if (ruleType === 'belegung') {
                return [
                  'belegung',
                  item.name || '',
                  (item.options || []).join(', '),
                  '', // FromCourse
                  '', // ToCourse
                  ''  // SameBand
                ];
              } else if (ruleType === 'folgekurs') {
                return [
                  'folgekurs',
                  item.name || '',
                  '', // Options
                  item.fromCourse || '',
                  item.toCourse || '',
                  item.sameBand ? 'true' : 'false'
                ];
              }
              return ['belegung', item.name || '', (item.options || []).join(', '), '', '', ''];
            });
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
      if (key === 'wv_workshops') {
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
function exportAssignment(schoolYearStart, schoolYearEnd, trimester, assignments) {
  const key = getSchoolYearKey(schoolYearStart, schoolYearEnd, trimester);
  try {
    const csvData = [];
    
    // Headers
    csvData.push(['Student', 'ErstesBand', 'ZweitesBand', 'Timestamp']);
    
    // Process assignments
    if (assignments?.erstesBand && assignments?.zweitesBand) {
      const allStudents = new Set([
        ...Object.keys(assignments.erstesBand),
        ...Object.keys(assignments.zweitesBand)
      ]);
      
      allStudents.forEach(student => {
        const first = assignments.erstesBand[student] || 'Nicht Zugeordnet';
        const second = assignments.zweitesBand[student] || 'Nicht Zugeordnet';
        csvData.push([student, first, second, new Date().toISOString()]);
      });
    } else {
      // Legacy format
      Object.entries(assignments || {}).forEach(([student, workshop]) => {
        csvData.push([student, workshop, '', new Date().toISOString()]);
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
    
    // Export all data types
    Object.entries(LS_KEYS).forEach(([keyName, lsKey]) => {
      if (keyName === 'assignments') {
        // Export assignments separately by year/trimester
        const assignments = allData[lsKey] || {};
        Object.entries(assignments).forEach(([slotKey, data]) => {
          const csvData = [];
          csvData.push(['Student', 'ErstesBand', 'ZweitesBand', 'Timestamp']);
          
          if (data?.assignments?.erstesBand && data?.assignments?.zweitesBand) {
            const allStudents = new Set([
              ...Object.keys(data.assignments.erstesBand),
              ...Object.keys(data.assignments.zweitesBand)
            ]);
            
            allStudents.forEach(student => {
              const first = data.assignments.erstesBand[student] || 'Nicht Zugeordnet';
              const second = data.assignments.zweitesBand[student] || 'Nicht Zugeordnet';
              csvData.push([student, first, second, data.timestamp || new Date().toISOString()]);
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
            // New format: RuleType, RuleName, Options, FromCourse, ToCourse, SameBand
            csvData = data.map(item => {
              const ruleType = item.type || 'belegung';
              if (ruleType === 'belegung') {
                return [
                  'belegung',
                  item.name || '',
                  (item.options || []).join(', '),
                  '', // FromCourse
                  '', // ToCourse
                  ''  // SameBand
                ];
              } else if (ruleType === 'folgekurs') {
                return [
                  'folgekurs',
                  item.name || '',
                  '', // Options
                  item.fromCourse || '',
                  item.toCourse || '',
                  item.sameBand ? 'true' : 'false'
                ];
              }
              return ['belegung', item.name || '', (item.options || []).join(', '), '', '', ''];
            });
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
      
      const rows = data.slice(1);
      
      // Determine data type from filename
      if (filename.startsWith('assignments/')) {
        const slotKey = filename.replace('assignments/', '').replace('.csv', '');
        if (!importedData.assignments) importedData.assignments = {};
        
        const assignments = { erstesBand: {}, zweitesBand: {} };
        rows.forEach(row => {
          if (row[0] && row[1]) {
            assignments.erstesBand[row[0]] = row[1];
            if (row[2]) assignments.zweitesBand[row[0]] = row[2];
          }
        });
        
        importedData.assignments[slotKey] = {
          assignments,
          timestamp: rows[0]?.[3] || new Date().toISOString(),
          bands: ['erstesBand', 'zweitesBand']
        };
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
          'priority-scores.csv': 'wv_studentPriorityScores',
          'workshop-colors.csv': 'wv_workshopColors',
          'student-comments.csv': 'wv_studentComments',
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

// Check if student needs to follow a Folgekurs rule
function getRequiredFolgekurs(student, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band) {
  const folgekursRules = rules.filter(r => (r.type || 'belegung') === 'folgekurs');
  if (folgekursRules.length === 0) return null;
  
  const prevKey = getPreviousTrimesterKey(schoolYearStart, schoolYearEnd, currentTrimester);
  const prevAssignment = confirmedAssignments[prevKey];
  
  if (!prevAssignment || !prevAssignment.assignments) return null;
  
  // Check both bands to see if student took the fromCourse in previous trimester
  const prevErstesBand = prevAssignment.assignments.erstesBand || {};
  const prevZweitesBand = prevAssignment.assignments.zweitesBand || {};
  
  const prevCourseErstes = prevErstesBand[student];
  const prevCourseZweites = prevZweitesBand[student];
  
  // Find a rule that applies
  for (const rule of folgekursRules) {
    let prevBand = null;
    if (prevCourseErstes === rule.fromCourse) {
      prevBand = 'erstesBand';
    } else if (prevCourseZweites === rule.fromCourse) {
      prevBand = 'zweitesBand';
    }
    
    if (prevBand) {
      // Check if sameBand is required
      if (rule.sameBand) {
        // Must be in the same band as the previous course
        return { course: rule.toCourse, band: prevBand };
      } else {
        // Can be in any band
        return { course: rule.toCourse, band: null };
      }
    }
  }
  
  return null;
}

// Auto-assignment algorithm for both Bands
// Ensures students don't get the same workshop in both bands
function autoAssignBothBands(students, workshops, prevAssignments, prereqs, choicesMap, studentAssistants = {}, studentPriorityScores = {}, rules = [], confirmedAssignments = {}, schoolYearStart, schoolYearEnd, currentTrimester, cannotBeParallel = {}) {
  // choicesMap: { erstesBand: { studentName: [choice1, choice2] }, zweitesBand: { studentName: [choice1, choice2] } }
  
  // Sort students by priority (higher priority first)
  const sortedStudents = [...students].sort((a, b) => {
    const scoreA = studentPriorityScores[a] || 5;
    const scoreB = studentPriorityScores[b] || 5;
    return scoreB - scoreA; // Higher score first
  });
  
  // First, assign all students to their first band (prioritizing high priority students)
  const erstesBandResult = autoAssignSingleBand(
    sortedStudents, 
    workshops, 
    prevAssignments, 
    prereqs, 
    choicesMap.erstesBand, 
    studentAssistants, 
    studentPriorityScores, 
    rules, 
    confirmedAssignments, 
    schoolYearStart, 
    schoolYearEnd, 
    currentTrimester, 
    'erstesBand'
  );
  
  // Now assign second band, but modify choices to exclude the workshop from first band
  // and also exclude workshops that cannot be parallel with the first band assignment
  const modifiedZweitesBandChoices = {};
  
  // Build modified choices map, removing first band assignments and "cannot be parallel" workshops
  Object.keys(choicesMap.zweitesBand || {}).forEach(student => {
    const originalChoices = choicesMap.zweitesBand[student] || [];
    const firstBandWorkshop = erstesBandResult.assignments[student];
    
    // Filter out the first band workshop from second band choices
    let filteredChoices = originalChoices.filter(choice => choice !== firstBandWorkshop);
    
    // Also filter out workshops that cannot be parallel with the first band assignment
    if (firstBandWorkshop) {
      const cannotBeParallelList = cannotBeParallel[firstBandWorkshop] || [];
      filteredChoices = filteredChoices.filter(choice => !cannotBeParallelList.includes(choice));
    }
    
    // Only include if there are still valid choices left
    if (filteredChoices.length > 0) {
      modifiedZweitesBandChoices[student] = filteredChoices;
    }
    // If student had choices but they all matched first band or cannot be parallel, they'll need manual assignment
  });
  
  // Also include students who don't have first band assignments but have second band choices
  Object.keys(choicesMap.zweitesBand || {}).forEach(student => {
    if (!erstesBandResult.assignments[student] && choicesMap.zweitesBand[student]) {
      modifiedZweitesBandChoices[student] = choicesMap.zweitesBand[student];
    }
  });
  
  // Assign second band with modified choices
  const zweitesBandResult = autoAssignSingleBand(
    sortedStudents, 
    workshops, 
    prevAssignments, 
    prereqs, 
    modifiedZweitesBandChoices, 
    studentAssistants, 
    studentPriorityScores, 
    rules, 
    confirmedAssignments, 
    schoolYearStart, 
    schoolYearEnd, 
    currentTrimester, 
    'zweitesBand'
  );
  
  // Post-process to fix any conflicts: if a student got the same workshop in both bands, 
  // unassign them from the second band (they'll need manual assignment)
  const conflicts = [];
  Object.keys(erstesBandResult.assignments).forEach(student => {
    const firstBand = erstesBandResult.assignments[student];
    const secondBand = zweitesBandResult.assignments[student];
    if (firstBand && secondBand && firstBand === secondBand) {
      // Remove the conflicting assignment from second band
      delete zweitesBandResult.assignments[student];
      // Update capacity tracking
      const capacity = getWorkshopCapacity(workshops[secondBand], secondBand);
      if (zweitesBandResult.kap) {
        zweitesBandResult.kap[secondBand] = (zweitesBandResult.kap[secondBand] || capacity) + 1;
      }
      // Update statistics
      if (zweitesBandResult.num1 > 0) zweitesBandResult.num1--;
      if (zweitesBandResult.num2 > 0) zweitesBandResult.num2--;
      conflicts.push(`${student} wurde in beiden Bändern ${firstBand} zugeordnet. Die Zuordnung im Zweiten Band wurde entfernt - bitte manuell zuordnen.`);
    }
  });
  
  // Also check students assigned in second band but not in first band
  Object.keys(zweitesBandResult.assignments).forEach(student => {
    const firstBand = erstesBandResult.assignments[student];
    const secondBand = zweitesBandResult.assignments[student];
    if (firstBand && secondBand && firstBand === secondBand) {
      // This should have been caught above, but double-check
      delete zweitesBandResult.assignments[student];
      const capacity = getWorkshopCapacity(workshops[secondBand], secondBand);
      if (zweitesBandResult.kap) {
        zweitesBandResult.kap[secondBand] = (zweitesBandResult.kap[secondBand] || capacity) + 1;
      }
      if (zweitesBandResult.num1 > 0) zweitesBandResult.num1--;
      if (zweitesBandResult.num2 > 0) zweitesBandResult.num2--;
    }
  });
  
  // Check for "cannot be parallel" conflicts
  Object.keys(erstesBandResult.assignments).forEach(student => {
    const firstBand = erstesBandResult.assignments[student];
    const secondBand = zweitesBandResult.assignments[student];
    if (firstBand && secondBand) {
      // Check if first band workshop has second band workshop in its "cannot be parallel" list
      const firstBandCannotBeParallel = cannotBeParallel[firstBand] || [];
      if (firstBandCannotBeParallel.includes(secondBand)) {
        // Remove the conflicting assignment from second band
        delete zweitesBandResult.assignments[student];
        const capacity = getWorkshopCapacity(workshops[secondBand], secondBand);
        if (zweitesBandResult.kap) {
          zweitesBandResult.kap[secondBand] = (zweitesBandResult.kap[secondBand] || capacity) + 1;
        }
        if (zweitesBandResult.num1 > 0) zweitesBandResult.num1--;
        if (zweitesBandResult.num2 > 0) zweitesBandResult.num2--;
        conflicts.push(`${student} wurde ${firstBand} (Erstes Band) und ${secondBand} (Zweites Band) zugeordnet, aber diese können nicht parallel belegt werden. Die Zuordnung im Zweiten Band wurde entfernt - bitte manuell zuordnen.`);
      }
      // Check if second band workshop has first band workshop in its "cannot be parallel" list
      const secondBandCannotBeParallel = cannotBeParallel[secondBand] || [];
      if (secondBandCannotBeParallel.includes(firstBand)) {
        // Remove the conflicting assignment from second band
        delete zweitesBandResult.assignments[student];
        const capacity = getWorkshopCapacity(workshops[secondBand], secondBand);
        if (zweitesBandResult.kap) {
          zweitesBandResult.kap[secondBand] = (zweitesBandResult.kap[secondBand] || capacity) + 1;
        }
        if (zweitesBandResult.num1 > 0) zweitesBandResult.num1--;
        if (zweitesBandResult.num2 > 0) zweitesBandResult.num2--;
        conflicts.push(`${student} wurde ${firstBand} (Erstes Band) und ${secondBand} (Zweites Band) zugeordnet, aber diese können nicht parallel belegt werden. Die Zuordnung im Zweiten Band wurde entfernt - bitte manuell zuordnen.`);
      }
    }
  });
  
  // Combine problems from both Bands with band information
  const allProblems = [
    ...erstesBandResult.problems.map(p => ({ message: p, band: 'erstesBand', bandLabel: 'Erstes Band' })),
    ...zweitesBandResult.problems.map(p => ({ message: p, band: 'zweitesBand', bandLabel: 'Zweites Band' })),
    ...conflicts.map(p => ({ message: p, band: 'both', bandLabel: 'Beide Bänder' }))
  ];
  
  // Calculate combined statistics
  const totalStudents = students.length;
  const totalFirst = erstesBandResult.num1 + zweitesBandResult.num1;
  const totalSecond = erstesBandResult.num2 + zweitesBandResult.num2;
  const percentFirst = (totalFirst / (totalStudents * 2)) * 100; // 2 assignments per student
  
  return {
    erstesBand: erstesBandResult,
    zweitesBand: zweitesBandResult,
    problems: allProblems,
    totalFirst,
    totalSecond,
    percentFirst
  };
}

// Single Band auto-assignment algorithm with special assistance distribution and priority scoring
function autoAssignSingleBand(students, workshops, prevAssignments, prereqs, choicesMap, studentAssistants = {}, studentPriorityScores = {}, rules = [], confirmedAssignments = {}, schoolYearStart, schoolYearEnd, currentTrimester, band) {
  // choicesMap: { studentName: [choice1, choice2] }
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
    const choices = (choicesMap[student] || []).filter(choice => 
      isWorkshopAvailableInBand(workshops, choice, band)
    );
    if (choices.length > 0) {
      filteredChoicesMap[student] = choices;
    } else if (choicesMap[student] && choicesMap[student].length > 0) {
      // Student has choices but none are available in this band
      problems.push(`${student} hat nur Werkstätten gewählt, die in ${band === 'erstesBand' ? 'Erstes' : 'Zweites'} Band nicht verfügbar sind.`);
    }
  });

  // Use filtered choices map
  const workingChoicesMap = filteredChoicesMap;

  // sanitize choices: if both choices same -> reduce to single
  for (const s of students) {
    const choices = workingChoicesMap[s] || [];
    if (choices.length === 2 && choices[0] === choices[1]) {
      problems.push(`${s} hat zweimal die gleiche Werkstatt ${choices[0]} gewählt.`);
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
    const required = getRequiredFolgekurs(s, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band);
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
    const requiredFolgekurs = getRequiredFolgekurs(s, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band);
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
    const requiredFolgekurs = getRequiredFolgekurs(s, rules, confirmedAssignments, schoolYearStart, schoolYearEnd, currentTrimester, band);
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

  // Third pass: Second choice allocation for those without assignment
  for (const s of students) {
    if (!(s in assignments)) {
      const ch = workingChoicesMap[s] || [];
      if (ch.length > 1) {
        const second = ch[1];
        if (!hasPrereqs(s, second, prevAssignments, prereqs)) {
          problems.push(`${s} erfüllt die Voraussetzungen für ${second} nicht.`);
          continue;
        }
        if ((kap[second] ?? 0) > 0) {
          assignments[s] = second;
          kap[second] -= 1;
          num2 += 1;
        }
      } else {
        problems.push(`${s} hat seine erste Wahl nicht bekommen und hat keine gültige zweite Wahl.`);
      }
    }
  }

  const percentFirst = (num1 / students.length) * 100;

  return { assignments, problems, kap, num1, num2, percentFirst };
}

// Helper function to check if an assignment is "not assigned"
function isNotAssigned(assignment) {
  if (!assignment) return true;
  const normalized = String(assignment).toLowerCase().trim();
  return normalized.includes('nicht') && normalized.includes('zugeordn');
}

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
    const [confirmedAssignments, setConfirmedAssignments] = useState(() => load(LS_KEYS.assignments, {}));
    const [rules, setRules] = useState(() => load(LS_KEYS.rules, []));
    const [studentTrimesters, setStudentTrimesters] = useState(() => load(LS_KEYS.studentTrimesters, {}));
    const [studentAssistants, setStudentAssistants] = useState(() => load(LS_KEYS.studentAssistants, {})); // NEW
  const [studentClasses, setStudentClasses] = useState(() => load(LS_KEYS.studentClasses, {})); // NEW: store class information for each student
  const [studentPriorityScores, setStudentPriorityScores] = useState(() => load(LS_KEYS.studentPriorityScores, {})); // NEW: map student -> priority score (1-10)
  const [workshopColors, setWorkshopColors] = useState(() => load(LS_KEYS.workshopColors, {})); // NEW: map workshop -> color hex
  const [studentComments, setStudentComments] = useState(() => load(LS_KEYS.studentComments, {})); // NEW: map student -> comment/notes
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
    useEffect(() => save(LS_KEYS.assignments, confirmedAssignments), [confirmedAssignments]);
    useEffect(() => save(LS_KEYS.rules, rules), [rules]);
    useEffect(() => save(LS_KEYS.studentTrimesters, studentTrimesters), [studentTrimesters]);
    useEffect(() => save(LS_KEYS.studentAssistants, studentAssistants), [studentAssistants]); // persist assistants
  useEffect(() => save(LS_KEYS.studentClasses, studentClasses), [studentClasses]); // persist student classes
  useEffect(() => save(LS_KEYS.studentPriorityScores, studentPriorityScores), [studentPriorityScores]); // persist priority scores
  useEffect(() => save(LS_KEYS.workshopColors, workshopColors), [workshopColors]); // persist workshop colors
  useEffect(() => save(LS_KEYS.studentComments, studentComments), [studentComments]); // persist student comments
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
  useEffect(() => save(LS_KEYS.archivedWorkshops, archivedWorkshops), [archivedWorkshops]); // persist archived workshops

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
    
    // Get unique classes for filter
    const uniqueClasses = useMemo(() => {
      const classes = new Set(Object.values(studentClasses).filter(c => c));
      return Array.from(classes).sort();
    }, [studentClasses]);

  // Wahl tab state
  const [uploadedChoices, setUploadedChoices] = useState(() => ({ erstesBand: {}, zweitesBand: {} }));
  const [autoResult, setAutoResult] = useState(null);
  const [dragAssignments, setDragAssignments] = useState(() => ({ erstesBand: {}, zweitesBand: {} }));
  const [yearTrimester, setYearTrimester] = useState(() => {
    const defaultSchoolYear = getDefaultSchoolYear();
    return { 
      schoolYearStart: defaultSchoolYear.schoolYearStart, 
      schoolYearEnd: defaultSchoolYear.schoolYearEnd, 
      trimester: 1 
    };
  });
  const [activeBand, setActiveBand] = useState('erstesBand'); // Track which Band is currently active
  const [checkedWarnings, setCheckedWarnings] = useState(() => {
    // Load checked warnings from localStorage
    const saved = localStorage.getItem('wv_checkedWarnings');
    return saved ? JSON.parse(saved) : {};
  }); // Track which warnings have been checked off
  
  // Persist checked warnings
  useEffect(() => {
    localStorage.setItem('wv_checkedWarnings', JSON.stringify(checkedWarnings));
  }, [checkedWarnings]);
  
  // Check for unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    const currentKey = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    const saved = confirmedAssignments[currentKey];
    
    // Check if there are any assignments in dragAssignments
    const hasAssignments = Object.keys(dragAssignments.erstesBand).length > 0 || 
                          Object.keys(dragAssignments.zweitesBand).length > 0;
    
    if (!hasAssignments) return false;
    
    // Check if assignments differ from saved
    if (!saved || !saved.assignments) return true;
    
    // Compare assignments
    const savedErstes = saved.assignments.erstesBand || {};
    const savedZweites = saved.assignments.zweitesBand || {};
    
    const currentErstes = dragAssignments.erstesBand || {};
    const currentZweites = dragAssignments.zweitesBand || {};
    
    // Check if any student has different assignment
    const allStudents = new Set([
      ...Object.keys(savedErstes),
      ...Object.keys(savedZweites),
      ...Object.keys(currentErstes),
      ...Object.keys(currentZweites)
    ]);
    
    for (const student of allStudents) {
      if (savedErstes[student] !== currentErstes[student] || 
          savedZweites[student] !== currentZweites[student]) {
        return true;
      }
    }
    
    return false;
  }, [dragAssignments, confirmedAssignments, yearTrimester]);

  // Calculate real-time statistics from drag assignments
  const currentStatistics = useMemo(() => {
    const erstesBand = dragAssignments.erstesBand || {};
    const zweitesBand = dragAssignments.zweitesBand || {};
    const erstesChoices = uploadedChoices.erstesBand || {};
    const zweitesChoices = uploadedChoices.zweitesBand || {};
    
    // Count first and second choices for each band separately
    let erstesBandFirst = 0;
    let erstesBandSecond = 0;
    let erstesBandTotal = 0; // Total assignments with choices in Erstes Band (including those who got neither)
    let zweitesBandFirst = 0;
    let zweitesBandSecond = 0;
    let zweitesBandTotal = 0; // Total assignments with choices in Zweites Band (including those who got neither)
    
    // Count Erstes Band - count ALL students who have choices for this band and are assigned
    Object.entries(erstesBand).forEach(([student, assignedWorkshop]) => {
      const choices = erstesChoices[student] || [];
      // Only count if student has choices for this band AND is assigned to a real workshop
      if (choices.length > 0 && assignedWorkshop && !isNotAssigned(assignedWorkshop)) {
        erstesBandTotal++; // Count ALL assignments (including those who got neither first nor second)
        if (assignedWorkshop === choices[0]) {
          erstesBandFirst++;
        } else if (choices.length > 1 && assignedWorkshop === choices[1]) {
          erstesBandSecond++;
        }
        // If neither first nor second, we still count it in erstesBandTotal but don't increment first/second
      }
    });
    
    // Count Zweites Band - count ALL students who have choices for this band and are assigned
    Object.entries(zweitesBand).forEach(([student, assignedWorkshop]) => {
      const choices = zweitesChoices[student] || [];
      // Only count if student has choices for this band AND is assigned to a real workshop
      if (choices.length > 0 && assignedWorkshop && !isNotAssigned(assignedWorkshop)) {
        zweitesBandTotal++; // Count ALL assignments (including those who got neither first nor second)
        if (assignedWorkshop === choices[0]) {
          zweitesBandFirst++;
        } else if (choices.length > 1 && assignedWorkshop === choices[1]) {
          zweitesBandSecond++;
        }
        // If neither first nor second, we still count it in zweitesBandTotal but don't increment first/second
      }
    });
    
    // Calculate percentages for each band separately
    // Percentage should be: first choices / total assignments (including those who got neither)
    const erstesBandPercentFirst = erstesBandTotal > 0 ? (erstesBandFirst / erstesBandTotal) * 100 : 0;
    const zweitesBandPercentFirst = zweitesBandTotal > 0 ? (zweitesBandFirst / zweitesBandTotal) * 100 : 0;
    
    // Combined totals
    const totalFirst = erstesBandFirst + zweitesBandFirst;
    const totalSecond = erstesBandSecond + zweitesBandSecond;
    const totalAssignments = erstesBandTotal + zweitesBandTotal; // Total from both bands (including those who got neither)
    const percentFirst = totalAssignments > 0 ? (totalFirst / totalAssignments) * 100 : 0;
    
    return {
      percentFirst,
      totalFirst,
      totalSecond,
      erstesBand: {
        num1: erstesBandFirst,
        num2: erstesBandSecond,
        total: erstesBandTotal,
        percentFirst: erstesBandPercentFirst
      },
      zweitesBand: {
        num1: zweitesBandFirst,
        num2: zweitesBandSecond,
        total: zweitesBandTotal,
        percentFirst: zweitesBandPercentFirst
      }
    };
  }, [dragAssignments, uploadedChoices]);

  // drag/drop UI state
  const [dragHover, setDragHover] = useState({ workshop: null, invalid: false, message: null });
  const [dropViolations, setDropViolations] = useState({}); // Temporary violations (cleared after 5s)
  const [persistentViolations, setPersistentViolations] = useState({}); // { workshopName: { studentName: message } }
  const scrollContainerRef = React.useRef(null);
  const topScrollbarRef = React.useRef(null);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  // Update window width on resize
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
  const fileInputRefBand1 = React.useRef(null);
  const fileInputRefBand2 = React.useRef(null);

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
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        
        if (lines.length === 0) {
              reject(new Error('Die Datei ist leer.'));
          return;
        }

        // Parse CSV (handle semicolon or comma separator)
        const data = lines.map(line => {
          const values = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if ((char === ';' || char === ',') && !inQuotes) {
              values.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current.trim());
          return values;
        });
            resolve(data);
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Fehler beim Lesen der CSV-Datei.'));
        reader.readAsText(file, 'UTF-8');
      }
    });
  }

  async function handleFileUpload(event, targetBand) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const data = await parseFileToData(file);
      
      if (data.length === 0) {
        alert('Die Datei ist leer.');
        return;
      }

      // Expected format: Name; Klasse; Übermittelt, Klasse, Q1, Q2
      // We ignore "Übermittelt" column
      const header = data[0].map(h => String(h).toLowerCase().trim());
      
      // Find column indices
      const nameIdx = header.findIndex(h => h.includes('name') || h.includes('schüler') || h.includes('student'));
      const klasseIdx = header.findIndex(h => h.includes('klasse') || h.includes('class'));
      const q1Idx = header.findIndex(h => {
        const hLower = h.toLowerCase();
        return hLower === 'q1' || hLower.includes('q1') || hLower.startsWith('q1');
      });
      const q2Idx = header.findIndex(h => {
        const hLower = h.toLowerCase();
        return hLower === 'q2' || hLower.includes('q2') || hLower.startsWith('q2');
      });

      // Fallback: if Q1/Q2 not found by name, try positional (after Klasse)
      let finalQ1Idx = q1Idx;
      let finalQ2Idx = q2Idx;
      
      if (finalQ1Idx === -1 || finalQ2Idx === -1) {
        // Try to find Q1/Q2 after Klasse column
        // Format: Name, Klasse, Übermittelt, Klasse, Q1, Q2
        // Look for columns that might be Q1/Q2 by position
        if (klasseIdx !== -1 && data[0].length > klasseIdx + 3) {
          // Check if columns after Klasse might be Q1/Q2
          // Usually Q1/Q2 are the last two columns
          if (data[0].length >= 2) {
            finalQ1Idx = data[0].length - 2; // Second to last
            finalQ2Idx = data[0].length - 1; // Last
          }
        }
      }

      if (nameIdx === -1) {
        alert('Fehler: Spalte "Name", "Student" oder "Schüler" nicht gefunden.');
        return;
      }

      if (finalQ1Idx === -1 || finalQ2Idx === -1) {
        alert('Fehler: Spalten "Q1" und "Q2" nicht gefunden. Erwartetes Format: Name; Klasse; Übermittelt, Klasse, Q1, Q2');
          return;
        }

        const summary = {
          newStudents: [],
          updatedClasses: [],
          newWorkshops: [],
          updatedChoices: 0,
        errors: [],
        band: targetBand === 'erstesBand' ? 'Erstes Band' : 'Zweites Band'
        };

        const newStudentClasses = { ...studentClasses };
        const newStudents = [...students];
        const newWorkshops = { ...workshops };
      const bandMap = { ...uploadedChoices[targetBand] };

        // Process each row
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (row.length < 2) continue;

        const studentName = String(row[nameIdx] || '').trim();
          if (!studentName) continue;

        const className = klasseIdx >= 0 ? String(row[klasseIdx] || '').trim() : '';
        const q1Value = finalQ1Idx >= 0 ? String(row[finalQ1Idx] || '').trim() : '';
        const q2Value = finalQ2Idx >= 0 ? String(row[finalQ2Idx] || '').trim() : '';

        // Parse Q1 and Q2, ignoring text after colon
        const q1 = parseChoiceValue(q1Value);
        const q2 = parseChoiceValue(q2Value);

          // Add new student if doesn't exist
          if (!students.includes(studentName)) {
            newStudents.push(studentName);
            summary.newStudents.push(studentName);
            // Initialize priority score for new student
            if (!studentPriorityScores[studentName]) {
              setStudentPriorityScores(prev => ({ ...prev, [studentName]: 5 }));
            }
          }

          // Update class information
          if (className && newStudentClasses[studentName] !== className) {
            const oldClass = newStudentClasses[studentName];
            newStudentClasses[studentName] = className;
            if (oldClass) {
              summary.updatedClasses.push({ student: studentName, old: oldClass, new: className });
            } else {
              summary.updatedClasses.push({ student: studentName, old: null, new: className });
            }
          }

        // Collect workshop choices (already normalized by parseChoiceValue)
        const choices = [];
        if (q1) choices.push(q1);
        if (q2) choices.push(q2);

        // Normalize choices and check/add workshops
        const normalizedChoices = choices.map(choice => {
          if (!choice) return '';
          const normalized = parseChoiceValue(choice);
          
          // Check if workshop exists (normalize existing workshop names for comparison)
          const existingWorkshop = Object.keys(workshops).find(w => {
            const normalizedW = parseChoiceValue(w);
            return normalizedW === normalized;
          });
          
          // If workshop doesn't exist, add it with normalized name
          if (!existingWorkshop && normalized) {
            newWorkshops[normalized] = 6; // Default capacity
            if (!summary.newWorkshops.includes(normalized)) {
              summary.newWorkshops.push(normalized);
            }
          }
          
          return normalized;
        }).filter(c => c); // Remove empty choices

        // Update choices for the target band (using normalized names)
        if (normalizedChoices.length > 0) {
          bandMap[studentName] = normalizedChoices;
            summary.updatedChoices++;
          }
        }

        // Apply all changes
        setStudents(newStudents);
    setStudentClasses(newStudentClasses);
        setWorkshops(newWorkshops);
      setUploadedChoices(prev => ({
        ...prev,
        [targetBand]: bandMap
      }));
        setUploadSummary(summary);

        // Reset file input
      if (targetBand === 'erstesBand' && fileInputRefBand1.current) {
        fileInputRefBand1.current.value = '';
      } else if (targetBand === 'zweitesBand' && fileInputRefBand2.current) {
        fileInputRefBand2.current.value = '';
      }

      alert(`Datei erfolgreich hochgeladen für ${summary.band}!\n${summary.updatedChoices} Schüler aktualisiert.`);
      } catch (error) {
      alert(`Fehler beim Lesen der Datei: ${error.message}`);
      }
  }

  function runAutoAssign() {
    const res = autoAssignBothBands(students, workshops, prevAssignments, prereqs, JSON.parse(JSON.stringify(uploadedChoices)), studentAssistants, studentPriorityScores, rules, confirmedAssignments, yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, cannotBeParallel);
    setAutoResult(res);
    // populate dragAssignments for interactive editing for both Bands
    // Include ALL students, even if they didn't vote
    const erstesBandDA = {};
    const zweitesBandDA = {};
    
    for (const s of students) {
      erstesBandDA[s] = res.erstesBand.assignments[s] || "Nicht Zugeordnen";
      zweitesBandDA[s] = res.zweitesBand.assignments[s] || "Nicht Zugeordnen";
    }
    
    setDragAssignments({ erstesBand: erstesBandDA, zweitesBand: zweitesBandDA });
  }

  function saveConfirmedAssignments() {
    // confirm/official: include school year & trimester metadata per requirement. Overwrite previous if same school year & trimester.
    // We will store assignments keyed by "YYYY-YYYY T#" e.g. "2025-2026 T1"
    const key = getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
    const payload = load(LS_KEYS.assignments, {});
    payload[key] = { 
      assignments: dragAssignments, 
      timestamp: new Date().toISOString(),
      bands: ['erstesBand', 'zweitesBand'] // Track that this contains both Bands
    };
    save(LS_KEYS.assignments, payload);
    setConfirmedAssignments(payload);
    
    // Export to CSV by school year/trimester
    exportAssignment(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, dragAssignments);
    
    // Update priority scores based on assignment results
    updatePriorityScores(dragAssignments, uploadedChoices);
    
    alert(`Zuweisungen für ${key} (beide Bänder) wurden als offiziell gespeichert und als CSV exportiert.`);
  }

  // Update priority scores based on assignment results (Option 1: Symmetrisches System)
  function updatePriorityScores(assignments, choices) {
    const updatedScores = { ...studentPriorityScores };
    
    // Initialize all students with default score of 5 if new
    students.forEach(student => {
      if (!updatedScores[student]) {
        updatedScores[student] = 5;
      }
    });
    
    // Process each student and calculate score changes for both bands
    students.forEach(student => {
      let totalChange = 0;
      let bandsProcessed = 0;
      
      // Process each band separately
      ['erstesBand', 'zweitesBand'].forEach(band => {
        const assigned = assignments[band]?.[student];
        const studentChoices = choices[band]?.[student] || [];
        
        // Only update priority if student has choices (voted) for this band
        if (studentChoices.length > 0 && assigned && assigned !== 'Nicht Zugeordnet' && assigned !== 'Nicht Zugeordnen') {
          const gotFirstChoice = assigned === studentChoices[0];
          const gotSecondChoice = assigned === studentChoices[1];
          
          let bandChange = 0;
          
          if (gotFirstChoice) {
            // Got first choice: -1 point (they're very happy, reduce priority significantly so others get chances first)
            bandChange = -1;
          } else if (gotSecondChoice) {
            // Got second choice: -0.5 points (they're somewhat happy, reduce priority slightly)
            bandChange = -0.5;
          } else {
            // Didn't get any choice: +1 point (they're unhappy, increase priority significantly for next time)
            bandChange = 1;
            // If they had a second choice and also didn't get it: +0.25 additional points (total +1.25)
            // This is worse because they had a backup option and still got nothing
            if (studentChoices.length >= 2) {
              bandChange = 1.25;
            }
          }
          
          totalChange += bandChange;
          bandsProcessed++;
        }
        // If student has no choices for this band, skip it (no change to priority score)
      });
      
      // Only update score if at least one band was processed (student voted in at least one band)
      if (bandsProcessed > 0) {
        // Calculate average change if both bands were processed, otherwise use the single band change
        const averageChange = totalChange / bandsProcessed;
        
        // Apply the change (rounded to nearest integer for display, but keep precision internally)
        const newScore = updatedScores[student] + averageChange;
        updatedScores[student] = Math.max(1, Math.min(10, Math.round(newScore * 10) / 10));
      }
      // If bandsProcessed === 0, student didn't vote in any band, so score remains unchanged
    });
    
    setStudentPriorityScores(updatedScores);
  }

  // Update individual student priority score
  function updateStudentPriorityScore(student, score) {
    const clampedScore = Math.max(1, Math.min(10, score));
    setStudentPriorityScores(prev => ({ ...prev, [student]: clampedScore }));
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

  // PDF Report generation functions - generates one PDF with all classes
  function generatePDFAllClassesReport() {
    const key = getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester);
    const assignmentData = confirmedAssignments[key];
    
    if (!assignmentData || !assignmentData.assignments) {
      alert(`Keine Daten für ${key} gefunden.`);
      return;
    }
    
    const assignments = assignmentData.assignments;
    
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
        const erstesBand = assignments.erstesBand?.[student] || 'Nicht zugeordnet';
        const zweitesBand = assignments.zweitesBand?.[student] || 'Nicht zugeordnet';
        
        const erstesBandRoom = erstesBand !== 'Nicht zugeordnet' ? (workshopRooms[erstesBand] || 'N/A') : '-';
        const erstesBandTeacher = erstesBand !== 'Nicht zugeordnet' ? (workshopTeachers[erstesBand] || 'N/A') : '-';
        const zweitesBandRoom = zweitesBand !== 'Nicht zugeordnet' ? (workshopRooms[zweitesBand] || 'N/A') : '-';
        const zweitesBandTeacher = zweitesBand !== 'Nicht zugeordnet' ? (workshopTeachers[zweitesBand] || 'N/A') : '-';
        
        // First row: Erstes Band (with student name)
        tableData.push([
          student,
          '1. Band',
          erstesBand,
          erstesBandRoom,
          erstesBandTeacher
        ]);
        
        // Second row: Zweites Band (without student name, empty cell for visual grouping)
        tableData.push([
          '', // Empty cell to show it's the same student
          '2. Band',
          zweitesBand,
          zweitesBandRoom,
          zweitesBandTeacher
        ]);
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
        const erstesBand = assignments.erstesBand?.[student] || 'Nicht zugeordnet';
        const zweitesBand = assignments.zweitesBand?.[student] || 'Nicht zugeordnet';
        
        const erstesBandRoom = erstesBand !== 'Nicht zugeordnet' ? (workshopRooms[erstesBand] || 'N/A') : '-';
        const erstesBandTeacher = erstesBand !== 'Nicht zugeordnet' ? (workshopTeachers[erstesBand] || 'N/A') : '-';
        const zweitesBandRoom = zweitesBand !== 'Nicht zugeordnet' ? (workshopRooms[zweitesBand] || 'N/A') : '-';
        const zweitesBandTeacher = zweitesBand !== 'Nicht zugeordnet' ? (workshopTeachers[zweitesBand] || 'N/A') : '-';
        
        // First row: Erstes Band (with student name)
        tableData.push([
          student,
          '1. Band',
          erstesBand,
          erstesBandRoom,
          erstesBandTeacher
        ]);
        
        // Second row: Zweites Band (without student name, empty cell for visual grouping)
        tableData.push([
          '', // Empty cell to show it's the same student
          '2. Band',
          zweitesBand,
          zweitesBandRoom,
          zweitesBandTeacher
        ]);
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
      
      // Get students for this workshop, sorted alphabetically
      const erstesBandStudents = Object.entries(assignments.erstesBand || {})
        .filter(([_, assignment]) => assignment === workshopName)
        .map(([student, _]) => student)
        .sort((a, b) => a.localeCompare(b));
      
      const zweitesBandStudents = Object.entries(assignments.zweitesBand || {})
        .filter(([_, assignment]) => assignment === workshopName)
        .map(([student, _]) => student)
        .sort((a, b) => a.localeCompare(b));
      
      // Students tables - separate for each band
      if (erstesBandStudents.length > 0 || zweitesBandStudents.length > 0) {
        // Erstes Band table
        if (erstesBandStudents.length > 0) {
          checkPageBreak(30);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text('Erstes Band:', 20, yPos);
          yPos += 8;
          
          const erstesBandTableData = erstesBandStudents.map(student => {
            const className = studentClasses[student] || 'Unbekannt';
            const needsAssistant = studentAssistants[student] ? 'Ja' : 'Nein';
            const comment = studentComments[student] || '';
            return [
              student,
              className,
              comment,
              needsAssistant
            ];
          });
          
          autoTable(doc, {
            startY: yPos,
            head: [['Schüler', 'Klasse', 'Bemerkung', 'Lernbegleitung']],
            body: erstesBandTableData,
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
        }
        
        // Zweites Band table
        if (zweitesBandStudents.length > 0) {
          checkPageBreak(30);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text('Zweites Band:', 20, yPos);
          yPos += 8;
          
          const zweitesBandTableData = zweitesBandStudents.map(student => {
            const className = studentClasses[student] || 'Unbekannt';
            const needsAssistant = studentAssistants[student] ? 'Ja' : 'Nein';
            const comment = studentComments[student] || '';
            return [
              student,
              className,
              comment,
              needsAssistant
            ];
          });
          
          autoTable(doc, {
            startY: yPos,
            head: [['Schüler', 'Klasse', 'Bemerkung', 'Lernbegleitung']],
            body: zweitesBandTableData,
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
        }
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
      
      // Get students for this workshop, sorted alphabetically
      const erstesBandStudents = Object.entries(assignments.erstesBand || {})
        .filter(([_, assignment]) => assignment === workshopName)
        .map(([student, _]) => student)
        .sort((a, b) => a.localeCompare(b));
      
      const zweitesBandStudents = Object.entries(assignments.zweitesBand || {})
        .filter(([_, assignment]) => assignment === workshopName)
        .map(([student, _]) => student)
        .sort((a, b) => a.localeCompare(b));
      
      // Students tables - separate for each band
      if (erstesBandStudents.length > 0 || zweitesBandStudents.length > 0) {
        // Erstes Band table
        if (erstesBandStudents.length > 0) {
          checkPageBreak(30);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text('Erstes Band:', 20, yPos);
          yPos += 8;
          
          const erstesBandTableData = erstesBandStudents.map(student => {
            const className = studentClasses[student] || 'Unbekannt';
            const needsAssistant = studentAssistants[student] ? 'Ja' : 'Nein';
            const comment = studentComments[student] || '';
            return [
              student,
              className,
              comment,
              needsAssistant
            ];
          });
          
          autoTable(doc, {
            startY: yPos,
            head: [['Schüler', 'Klasse', 'Bemerkung', 'Lernbegleitung']],
            body: erstesBandTableData,
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
        }
        
        // Zweites Band table
        if (zweitesBandStudents.length > 0) {
          checkPageBreak(30);
          doc.setFontSize(12);
          doc.setFont(undefined, 'bold');
          doc.text('Zweites Band:', 20, yPos);
          yPos += 8;
          
          const zweitesBandTableData = zweitesBandStudents.map(student => {
            const className = studentClasses[student] || 'Unbekannt';
            const needsAssistant = studentAssistants[student] ? 'Ja' : 'Nein';
            const comment = studentComments[student] || '';
            return [
              student,
              className,
              comment,
              needsAssistant
            ];
          });
          
          autoTable(doc, {
            startY: yPos,
            head: [['Schüler', 'Klasse', 'Bemerkung', 'Lernbegleitung']],
            body: zweitesBandTableData,
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
        }
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
        [LS_KEYS.studentPriorityScores]: studentPriorityScores,
        [LS_KEYS.workshopColors]: workshopColors,
        [LS_KEYS.studentComments]: studentComments,
        [LS_KEYS.workshopTeachers]: workshopTeachers,
        [LS_KEYS.workshopRooms]: workshopRooms,
        [LS_KEYS.archivedWorkshops]: archivedWorkshops,
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
      if (importedData[LS_KEYS.studentPriorityScores]) setStudentPriorityScores(importedData[LS_KEYS.studentPriorityScores]);
      if (importedData[LS_KEYS.workshopColors]) setWorkshopColors(importedData[LS_KEYS.workshopColors]);
      if (importedData[LS_KEYS.studentComments]) setStudentComments(importedData[LS_KEYS.studentComments]);
      if (importedData[LS_KEYS.workshopTeachers]) setWorkshopTeachers(importedData[LS_KEYS.workshopTeachers]);
      if (importedData[LS_KEYS.workshopRooms]) setWorkshopRooms(importedData[LS_KEYS.workshopRooms]);
      if (importedData[LS_KEYS.archivedWorkshops]) setArchivedWorkshops(importedData[LS_KEYS.archivedWorkshops]);
      if (importedData.assignments) {
        setConfirmedAssignments(importedData.assignments);
      }
      
      alert('Daten wurden erfolgreich importiert!');
      
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
    // Check if workshop is available in this band
    if (!isWorkshopAvailableInBand(workshops, workshopName, band)) {
      return { ok: false, reason: `Diese Werkstatt ist in ${band === 'erstesBand' ? 'Erstes' : 'Zweites'} Band nicht verfügbar.` };
    }
    
    // Check "cannot be parallel" constraint
    const otherBand = band === 'erstesBand' ? 'zweitesBand' : 'erstesBand';
    const otherBandAssignment = dragAssignments[otherBand]?.[student];
    if (otherBandAssignment) {
      // Check if the other band assignment has this workshop in its "cannot be parallel" list
      const otherBandCannotBeParallel = cannotBeParallel[otherBandAssignment] || [];
      if (otherBandCannotBeParallel.includes(workshopName)) {
        return { ok: false, reason: `Kann nicht parallel zu ${otherBandAssignment} (${otherBand === 'erstesBand' ? 'Erstes' : 'Zweites'} Band) belegt werden.` };
      }
      // Check if this workshop has the other band assignment in its "cannot be parallel" list
      const thisWorkshopCannotBeParallel = cannotBeParallel[workshopName] || [];
      if (thisWorkshopCannotBeParallel.includes(otherBandAssignment)) {
        return { ok: false, reason: `Kann nicht parallel zu ${otherBandAssignment} (${otherBand === 'erstesBand' ? 'Erstes' : 'Zweites'} Band) belegt werden.` };
      }
    }
    
    // Check capacity
    const counts = getCurrentWorkshopCounts();
    const capacity = getWorkshopCapacity(workshops[workshopName], workshopName);
    if ((counts[workshopName] ?? 0) >= capacity) {
      return { ok: false, reason: `Kapazität erreicht (${counts[workshopName]}/${capacity})` };
    }
    // Check previous assignment rule: don't assign if same as last year
    const last = prevAssignments[student];
    if (last && last === workshopName) {
      return { ok: false, reason: `Schüler hatte diese Werkstatt bereits letztes Jahr (${last}).` };
    }
    // Check prerequisites
    if (!hasPrereqs(student, workshopName, prevAssignments, prereqs)) {
      return { ok: false, reason: `Voraussetzungen für ${workshopName} nicht erfüllt.` };
    }

    // Check Folgekurs rules
    const requiredFolgekurs = getRequiredFolgekurs(student, rules, confirmedAssignments, yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, band);
    if (requiredFolgekurs) {
      // Check if the rule is already fulfilled in the current assignments
      const currentAssignments = dragAssignments;
      const erstesBandAssignment = currentAssignments.erstesBand?.[student];
      const zweitesBandAssignment = currentAssignments.zweitesBand?.[student];
      
      // Check if rule is already fulfilled
      let isFulfilled = false;
      if (requiredFolgekurs.band !== null) {
        // sameBand is required - check only the same band
        if (requiredFolgekurs.band === 'erstesBand' && erstesBandAssignment === requiredFolgekurs.course) {
          isFulfilled = true;
        } else if (requiredFolgekurs.band === 'zweitesBand' && zweitesBandAssignment === requiredFolgekurs.course) {
          isFulfilled = true;
        }
        
        // If sameBand is required, check this specific band
        if (requiredFolgekurs.band === band) {
          // This is the band where the rule applies
          if (!isFulfilled && requiredFolgekurs.course !== workshopName) {
            const prevKey = getPreviousTrimesterKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
            return { 
              ok: false, 
              reason: `Folgekurs-Regel: Schüler muss ${requiredFolgekurs.course} belegen (hat im vorherigen Trimester ${prevKey} einen Kurs belegt, der diese Regel auslöst).` 
            };
          }
        } else {
          // This is NOT the required band, but student is trying to assign the required course here
          // This is wrong - they should assign it in the required band
          if (workshopName === requiredFolgekurs.course) {
            return { 
              ok: false, 
              reason: `Folgekurs-Regel: ${requiredFolgekurs.course} muss im ${requiredFolgekurs.band === 'erstesBand' ? 'Ersten' : 'Zweiten'} Band belegt werden (gleiches Band wie im vorherigen Trimester erforderlich).` 
            };
          }
        }
      } else {
        // sameBand is not required - check both bands
        if (erstesBandAssignment === requiredFolgekurs.course || zweitesBandAssignment === requiredFolgekurs.course) {
          isFulfilled = true;
        }
        
        // Only warn if rule is not fulfilled and student is trying to assign something else
        if (!isFulfilled && requiredFolgekurs.course !== workshopName) {
          const prevKey = getPreviousTrimesterKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester);
          return { 
            ok: false, 
            reason: `Folgekurs-Regel: Schüler muss ${requiredFolgekurs.course} belegen (hat im vorherigen Trimester ${prevKey} einen Kurs belegt, der diese Regel auslöst).` 
          };
        }
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
    
    // Check for conflict with other band
    const otherBand = activeBand === 'erstesBand' ? 'zweitesBand' : 'erstesBand';
    const otherBandAssignment = dragAssignments[otherBand]?.[student];
    if (otherBandAssignment === workshopName && workshopName !== 'Nicht Zugeordnet') {
      setDragHover({ 
        workshop: workshopName, 
        invalid: true, 
        message: `Konflikt: Bereits in ${otherBand === 'erstesBand' ? 'Erstes' : 'Zweites'} Band zugeordnet` 
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
    
    // Check if this would create a conflict (same workshop in both bands)
    const otherBand = activeBand === 'erstesBand' ? 'zweitesBand' : 'erstesBand';
    const otherBandAssignment = dragAssignments[otherBand]?.[student];
    if (otherBandAssignment === workshopName && workshopName !== 'Nicht Zugeordnet' && workshopName !== 'Nicht Zugeordnen') {
      const errorMsg = `Kann nicht zugeordnet werden: ${student} ist bereits in ${otherBand === 'erstesBand' ? 'Erstes' : 'Zweites'} Band ${workshopName} zugeordnet.`;
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
    setDragAssignments(prev => ({ 
      ...prev, 
      [activeBand]: { ...prev[activeBand], [student]: workshopName }
    }));
    
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
      const requiredFolgekurs = getRequiredFolgekurs(student, rules, confirmedAssignments, yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester, activeBand);
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
                [student]: `Folgekurs-Regel: Schüler muss ${requiredFolgekurs.course} belegen (hat im vorherigen Trimester ${getPreviousTrimesterKey(yearTrimester.year, yearTrimester.trimester)} einen Kurs belegt, der diese Regel auslöst).`
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
  }

  function finalizeAndOverwriteConfirm() {
    if (window.confirm("Möchtest du diese Zuordnungen offiziell speichern und ggf. letztes Eintrag für dasses Jahr/Trimester überschreiben?")) {
      saveConfirmedAssignments();
    }
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
  
  function addWorkshop(name, cap) {
    if (!name) return;
    setWorkshops(prev => ({
      ...prev,
      [name]: {
        capacity: Number(cap || 0),
        availableBands: ['erstesBand', 'zweitesBand'] // Default: available in both bands
      }
    }));
  }
  // Check if a workshop has been taken by any student
  function hasWorkshopBeenTaken(workshopName) {
    // Check in confirmedAssignments
    for (const [, payload] of Object.entries(confirmedAssignments)) {
      if (payload.assignments) {
        // Check both bands
        const erstesBand = payload.assignments.erstesBand || {};
        const zweitesBand = payload.assignments.zweitesBand || {};
        if (Object.values(erstesBand).includes(workshopName) || Object.values(zweitesBand).includes(workshopName)) {
          return true;
        }
        // Check legacy format
        const legacyAssignments = payload.assignments;
        if (typeof legacyAssignments === 'object' && !legacyAssignments.erstesBand) {
          if (Object.values(legacyAssignments).includes(workshopName)) {
            return true;
          }
        }
      }
    }
    // Check in prevAssignments
    for (const student in prevAssignments) {
      const prev = prevAssignments[student];
      if (Array.isArray(prev) && prev.includes(workshopName)) {
        return true;
      } else if (prev === workshopName) {
        return true;
      }
    }
    // Check in current dragAssignments
    const erstesBand = dragAssignments.erstesBand || {};
    const zweitesBand = dragAssignments.zweitesBand || {};
    if (Object.values(erstesBand).includes(workshopName) || Object.values(zweitesBand).includes(workshopName)) {
      return true;
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

  // Rules tab: manage rules - students must have taken ALL listed courses at some point
  // Rule types:
  // - "belegung": { type: "belegung", name, options: ["Kunst I","Kunst II"] } - student must have taken ALL courses
  // - "folgekurs": { type: "folgekurs", name, fromCourse, toCourse, sameBand: boolean } - if student takes fromCourse in trimester T, they must take toCourse in trimester T+1
  function addRule(rule) {
    setRules(prev => [...prev, { ...rule, id: Date.now() }]);
  }
  function deleteRule(id) {
    setRules(prev => prev.filter(r => r.id !== id));
  }

  // Student trimester management
  function updateStudentTrimester(student, trimester) {
    setStudentTrimesters(prev => ({ ...prev, [student]: trimester }));
  }

  // Update student comment
  function updateStudentComment(student, comment) {
    setStudentComments(prev => ({ ...prev, [student]: comment }));
  }

  // NEW: toggle personal assistant flag for a student
  function toggleStudentAssistant(student) {
    setStudentAssistants(prev => ({ ...prev, [student]: !prev[student] }));
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
    if (choices && choices.length === 2 && choices[0] === choices[1]) {
      issues.push("Wahl enthält zweimal dieselbe Werkstatt.");
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
  function getAssignmentsForBand(band) {
    return dragAssignments[band] || {};
  }

  // Check for students assigned to same workshop in both bands
  function getStudentsWithSameWorkshopInBothBands() {
    const erstesBand = dragAssignments.erstesBand || {};
    const zweitesBand = dragAssignments.zweitesBand || {};
    const conflicts = [];

    Object.keys(erstesBand).forEach(student => {
      const firstBandWorkshop = erstesBand[student];
      const secondBandWorkshop = zweitesBand[student];
      
      if (firstBandWorkshop && 
          secondBandWorkshop && 
          firstBandWorkshop !== 'Nicht Zugeordnet' && 
          firstBandWorkshop !== 'Nicht Zugeordnen' &&
          secondBandWorkshop !== 'Nicht Zugeordnet' && 
          secondBandWorkshop !== 'Nicht Zugeordnen' &&
          firstBandWorkshop === secondBandWorkshop) {
        conflicts.push({
          student,
          workshop: firstBandWorkshop
        });
      }
    });

    return conflicts;
  }

  // Check which students have no votes/choices for the active band
  function hasNoVotesForBand(student, band) {
    const choices = getChoicesForBand(band)[student];
    return !choices || choices.length === 0;
  }

  // Get all students without votes for the active band
  function getStudentsWithoutVotes() {
    return students.filter(s => hasNoVotesForBand(s, activeBand));
  }

  // Check for students with same first choice in both bands
  function getStudentsWithSameFirstChoiceInBothBands() {
    const erstesBandChoices = getChoicesForBand('erstesBand');
    const zweitesBandChoices = getChoicesForBand('zweitesBand');
    const conflicts = [];

    students.forEach(student => {
      const firstBandFirstChoice = erstesBandChoices[student]?.[0];
      const secondBandFirstChoice = zweitesBandChoices[student]?.[0];
      
      if (firstBandFirstChoice && 
          secondBandFirstChoice && 
          firstBandFirstChoice === secondBandFirstChoice) {
        conflicts.push({
          student,
          workshop: firstBandFirstChoice
        });
      }
    });

    return conflicts;
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
      // Check if this is a multi-Band assignment
      if (payload.bands && payload.bands.includes('erstesBand') && payload.bands.includes('zweitesBand')) {
        const erstesBandAssigned = payload.assignments.erstesBand && payload.assignments.erstesBand[student] ? payload.assignments.erstesBand[student] : 'Nicht Zugeordnet';
        const zweitesBandAssigned = payload.assignments.zweitesBand && payload.assignments.zweitesBand[student] ? payload.assignments.zweitesBand[student] : 'Nicht Zugeordnet';
        history.push({ 
          slotKey, 
          assigned: `${erstesBandAssigned} / ${zweitesBandAssigned}`, 
          timestamp: payload.timestamp,
          erstesBand: erstesBandAssigned,
          zweitesBand: zweitesBandAssigned
        });
      } else {
        // Legacy single assignment format
        const assigned = payload.assignments && payload.assignments[student] ? payload.assignments[student] : 'Nicht Zugeordnet';
        history.push({ slotKey, assigned, timestamp: payload.timestamp });
      }
    });
    // sort by slotKey descending (simple heuristic: later years first if keys like 2025-T1)
    history.sort((a,b) => (a.slotKey < b.slotKey ? 1 : -1));
    return history;
  }

  // ----------------------------
  // UI
  // ----------------------------
  return (
    <div className="app-container">
      {/* Unsaved Changes Warning */}
      {hasUnsavedChanges && (
        <div className="w-full bg-gray-100 border-b border-gray-300 py-2 px-6">
          <div className="max-w-7xl mx-auto text-sm text-gray-600">
            ⚠️ Ungespeicherte Änderungen vorhanden. Bitte speichern Sie die Zuweisungen im Tab "Wahl & Zuordnung".
          </div>
        </div>
      )}
      
      <header className="app-header">
        <h1 className="app-title">Werkstatt-Verwaltung</h1>
        <nav className="nav-buttons">
          <button className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            tab==='students' 
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg' 
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`} onClick={()=>setTab('students')}>Schüler</button>
          <button className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            tab==='wahl' 
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg' 
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`} onClick={()=>setTab('wahl')}>Wahl & Zuordnung</button>
          <button className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            tab==='reports' 
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg' 
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`} onClick={()=>setTab('reports')}>Berichte</button>
          <button className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            tab==='workshops' 
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg' 
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`} onClick={()=>setTab('workshops')}>Werkstätten</button>
          <button className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            tab==='rules' 
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg' 
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`} onClick={()=>setTab('rules')}>Belegungs-Regeln</button>
          <button className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            tab==='data' 
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg' 
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`} onClick={()=>setTab('data')}>Daten</button>
        </nav>
      </header>

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
                          className={`p-3 rounded-lg mb-2 transition-all duration-200 ${
                          selectedStudent===s
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg transform scale-105'
                              : selectedStudents.has(s)
                              ? 'bg-gradient-to-r from-yellow-100 to-yellow-200 border-2 border-yellow-400 shadow-md'
                            : 'bg-gradient-to-r from-white to-gray-50 hover:from-gray-100 hover:to-gray-200 shadow-sm hover:shadow-md border border-gray-200'
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
                          <div className="font-medium">{s}</div>
                                {studentClasses[s] && (
                                  <div className={`text-xs ${selectedStudent===s ? 'text-blue-100' : 'text-gray-500'}`}>
                                    Klasse: {studentClasses[s]}
                        </div>
                                )}
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
                    <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 shadow-sm border border-green-200">
                      <div className="flex items-center justify-between mb-6 border-b border-green-300 pb-3">
                        <h2 className="text-2xl font-bold text-green-900">{selectedStudent}</h2>
                        {studentClasses[selectedStudent] && (
                          <span className="px-3 py-1 bg-green-200 text-green-800 rounded-lg text-sm font-semibold">
                            Klasse: {studentClasses[selectedStudent]}
                          </span>
                        )}
                      </div>

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Lernbegleitung nötig</h3>
                      <div className="detail-content">
                        <label className="inline-flex items-center p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg hover:from-gray-100 hover:to-gray-200 transition-all duration-200 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={!!studentAssistants[selectedStudent]} 
                            onChange={() => toggleStudentAssistant(selectedStudent)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="ml-3 font-medium">Ja, benötigt Lernbegleitung</span>
                        </label>
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <div className="flex items-center justify-between mb-3 border-b border-gray-300 pb-2">
                        <h3 className="text-lg font-semibold text-gray-800">Prioritätspunktzahl</h3>
                        <div className="group relative inline-block">
                          <svg className="w-5 h-5 text-blue-500 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div className="absolute left-1/2 bottom-full mb-2 transform -translate-x-1/2 w-80 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                            Prioritätspunktzahl (1-10): Bestimmt die Reihenfolge bei der Zuweisung. HÖHERE Punktzahlen = höhere Priorität (werden zuerst zugewiesen). Die Punktzahl wird automatisch angepasst: Pro Band - Erste Wahl erhalten: -1 Punkt, Zweite Wahl erhalten: -0.5 Punkte, Keine Wahl erhalten: +1 Punkt, Auch zweite Wahl nicht erhalten: +1.25 Punkte. Beide Bänder werden gemittelt. Schüler mit Lernbegleitung haben immer höchste Priorität.
                          </div>
                        </div>
                      </div>
                      <div className="detail-content">
                        <div className="flex items-center space-x-3">
                          <input 
                            type="number" 
                            min="1" 
                            max="10" 
                            value={studentPriorityScores[selectedStudent] || 5} 
                            onChange={(e) => updateStudentPriorityScore(selectedStudent, parseInt(e.target.value) || 5)}
                            className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-lg font-semibold"
                          />
                          <span className="text-sm text-gray-600">/ 10</span>
                          <span className="text-xs text-gray-500 italic">
                            {studentPriorityScores[selectedStudent] >= 8 ? 'Hoch' : 
                             studentPriorityScores[selectedStudent] >= 5 ? 'Mittel' : 
                             'Niedrig'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Trimester (aktuell)</h3>
                      <select 
                        value={studentTrimesters[selectedStudent] || ''} 
                        onChange={(e) => updateStudentTrimester(selectedStudent, e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      >
                        <option value="">Bitte wählen...</option>
                        <option value="1">1. Trimester</option>
                        <option value="2">2. Trimester</option>
                        <option value="3">3. Trimester</option>
                      </select>
                    </div>

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Notizen / Kommentare</h3>
                      <textarea
                        value={studentComments[selectedStudent] || ''}
                        onChange={(e) => updateStudentComment(selectedStudent, e.target.value)}
                        placeholder="Notizen zu diesem Schüler..."
                        rows={4}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 resize-y"
                      />
                      <div className="text-xs text-gray-500 mt-1">
                        {studentComments[selectedStudent]?.length || 0} Zeichen
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Pflichtkurse (fehlend — anhand Regeln geprüft)</h3>
                      <div className="detail-content">
                        {rules.length===0 ? (
                          <div className="text-gray-500 italic p-3 bg-gray-50 rounded-lg">Keine Regeln definiert.</div>
                        ) : (
                          <ul className="space-y-2">
                            {rules.map(r => {
                              const ruleType = r.type || 'belegung';
                              
                              if (ruleType === 'belegung') {
                                // determine if the student's history contains ALL of the options (not just one)
                                const history = buildHistoryForStudent(selectedStudent).map(h => {
                                  // Extract both bands if available
                                  if (h.erstesBand && h.zweitesBand) {
                                    return [h.erstesBand, h.zweitesBand];
                                  }
                                  return [h.assigned];
                                }).flat();
                                
                                // Check if student has ALL required courses
                                const hasAll = (r.options || []).every(opt => history.includes(opt));
                                return (
                                  <li key={r.id} className={`p-3 rounded-lg ${hasAll ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <span className="font-medium">{r.name}</span> — 
                                        <span className={`ml-2 font-semibold ${hasAll ? 'text-green-700' : 'text-red-700'}`}>
                                          {hasAll ? 'Erfüllt' : 'Nicht erfüllt'}
                                        </span>
                                      </div>
                                      <div className="group relative inline-block ml-2">
                                        <svg className="w-4 h-4 text-blue-500 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div className="absolute right-0 bottom-full mb-2 transform w-64 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                                          <strong>Regel:</strong> Der Schüler muss <strong>alle</strong> Kurse ({(r.options || []).join(', ')}) mindestens einmal belegt haben. {hasAll ? '✓ Alle Kurse wurden bereits belegt.' : '✗ Noch nicht alle Kurse belegt.'}
                                        </div>
                                      </div>
                                    </div>
                                  </li>
                                );
                              } else if (ruleType === 'folgekurs') {
                                // For Folgekurs rules, check if the rule is satisfied based on previous and current trimester assignments
                                const history = buildHistoryForStudent(selectedStudent);
                                // Sort history by slotKey to get chronological order
                                const sortedHistory = [...history].sort((a, b) => {
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
                                  const hasFromCourse = (current.erstesBand === r.fromCourse || current.zweitesBand === r.fromCourse) ||
                                                       (!current.erstesBand && !current.zweitesBand && current.assigned === r.fromCourse);
                                  
                                  if (hasFromCourse) {
                                    // Check if toCourse is in next trimester
                                    const hasToCourse = (next.erstesBand === r.toCourse || next.zweitesBand === r.toCourse) ||
                                                       (!next.erstesBand && !next.zweitesBand && next.assigned === r.toCourse);
                                    
                                    if (!hasToCourse) {
                                      isSatisfied = false;
                                      violationMessage = `Nach ${r.fromCourse} muss ${r.toCourse} im nächsten Trimester belegt werden.`;
                                      break;
                                    }
                                    
                                    // If sameBand is required, check that toCourse is in the same band
                                    if (r.sameBand && current.erstesBand && current.zweitesBand && next.erstesBand && next.zweitesBand) {
                                      const fromBand = current.erstesBand === r.fromCourse ? 'erstesBand' : 'zweitesBand';
                                      const toBand = next.erstesBand === r.toCourse ? 'erstesBand' : 'zweitesBand';
                                      
                                      if (fromBand !== toBand) {
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

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Regelverstöße (Wahlen)</h3>
                      <div className="detail-content">
                        <div className="mb-4">
                          <h4 className="font-semibold text-sm mb-2 text-blue-700">Erstes Band:</h4>
                          {getChoicesForBand('erstesBand')[selectedStudent] ? (
                            <ul className="space-y-1">
                              {checkViolationsForStudent(selectedStudent, getChoicesForBand('erstesBand')[selectedStudent]).map((i, idx) => (
                                <li key={idx} className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{i}</li>
                              ))}
                              {checkViolationsForStudent(selectedStudent, getChoicesForBand('erstesBand')[selectedStudent]).length===0 && (
                                <li className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">Keine Auffälligkeiten</li>
                              )}
                            </ul>
                          ) : <div className="text-gray-500 italic p-2 bg-gray-50 rounded">Keine Wahl-Daten geladen.</div>}
                        </div>
                        <div>
                          <h4 className="font-semibold text-sm mb-2 text-blue-700">Zweites Band:</h4>
                          {getChoicesForBand('zweitesBand')[selectedStudent] ? (
                            <ul className="space-y-1">
                              {checkViolationsForStudent(selectedStudent, getChoicesForBand('zweitesBand')[selectedStudent]).map((i, idx) => (
                                <li key={idx} className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{i}</li>
                              ))}
                              {checkViolationsForStudent(selectedStudent, getChoicesForBand('zweitesBand')[selectedStudent]).length===0 && (
                                <li className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">Keine Auffälligkeiten</li>
                              )}
                            </ul>
                          ) : <div className="text-gray-500 italic p-2 bg-gray-50 rounded">Keine Wahl-Daten geladen.</div>}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Vergangene Wahlen</h3>
                      <div className="detail-content">
                        <div className="space-y-4">
                          <div>
                            <h4 className="font-semibold text-sm mb-2 text-blue-700">Erstes Band:</h4>
                            {getChoicesForBand('erstesBand')[selectedStudent] ? (
                              <div className="space-y-1">
                                {getChoicesForBand('erstesBand')[selectedStudent].map((choice, idx) => (
                                  <div key={idx} className="p-2 bg-blue-50 border border-blue-200 rounded text-sm">
                                    <span className="font-medium">{idx + 1}. Wahl:</span> {choice}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-gray-500 italic p-2 bg-gray-50 rounded text-sm">Keine Wahlen geladen.</div>
                            )}
                          </div>
                          <div>
                            <h4 className="font-semibold text-sm mb-2 text-purple-700">Zweites Band:</h4>
                            {getChoicesForBand('zweitesBand')[selectedStudent] ? (
                              <div className="space-y-1">
                                {getChoicesForBand('zweitesBand')[selectedStudent].map((choice, idx) => (
                                  <div key={idx} className="p-2 bg-purple-50 border border-purple-200 rounded text-sm">
                                    <span className="font-medium">{idx + 1}. Wahl:</span> {choice}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-gray-500 italic p-2 bg-gray-50 rounded text-sm">Keine Wahlen geladen.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Werkstatt-Historie (zugeordnete Kurse nach Jahr/Trimester)</h3>
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
{tab === 'wahl' && (
  <section className="wahl-tab space-y-8 w-full">
    {/* --- BAND SELECTION TABS --- */}
    <div className="bg-white rounded-2xl shadow p-5">
      <div className="flex space-x-2 mb-6">
        <button
          onClick={() => setActiveBand('erstesBand')}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            activeBand === 'erstesBand'
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg transform scale-105'
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`}
        >
          Erstes Band
        </button>
        <button
          onClick={() => setActiveBand('zweitesBand')}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
            activeBand === 'zweitesBand'
              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg transform scale-105'
              : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
          }`}
        >
          Zweites Band
        </button>
      </div>

      {/* --- SCHOOL YEAR/TRIMESTER SELECTION --- */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-100 rounded-xl p-4 mb-6 shadow-sm border border-indigo-200">
        <h3 className="text-lg font-semibold text-indigo-900 mb-3 border-b border-indigo-300 pb-2">Schuljahr & Trimester Auswahl</h3>
        <div className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Schuljahr Start:</label>
            <input 
              type="number" 
              value={yearTrimester.schoolYearStart} 
              onChange={(e) => {
                const start = parseInt(e.target.value) || getDefaultSchoolYear().schoolYearStart;
                setYearTrimester(prev => ({ ...prev, schoolYearStart: start, schoolYearEnd: start + 1 }));
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 w-24"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Schuljahr Ende:</label>
            <input 
              type="number" 
              value={yearTrimester.schoolYearEnd} 
              onChange={(e) => {
                const end = parseInt(e.target.value) || getDefaultSchoolYear().schoolYearEnd;
                setYearTrimester(prev => ({ ...prev, schoolYearEnd: end, schoolYearStart: end - 1 }));
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 w-24"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trimester:</label>
            <select 
              value={yearTrimester.trimester} 
              onChange={(e) => setYearTrimester(prev => ({ ...prev, trimester: parseInt(e.target.value) }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
            >
              <option value={1}>1. Trimester</option>
              <option value={2}>2. Trimester</option>
              <option value={3}>3. Trimester</option>
            </select>
          </div>
          <div className="text-sm text-gray-600 bg-white px-3 py-2 rounded-lg border border-gray-200">
            <strong>Speichern unter:</strong> {getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester)}
          </div>
        </div>
      </div>

      {/* --- TOP SECTION: Upload + AutoAssign Results + Buttons --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Wahl Upload */}
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-300 pb-2">
            Wahl-Daten ({activeBand === 'erstesBand' ? 'Erstes' : 'Zweites'} Band)
          </h3>

          {!Object.keys(getChoicesForBand(activeBand)).length && (
            <div className="text-gray-500 italic">
              Keine Daten. Verwende „Simuliere Datei-Upload", um Beispieldaten zu laden.
            </div>
          )}

          <div className="max-h-[300px] overflow-y-auto border-t border-gray-200 mt-2 pt-2 text-sm">
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
                  <div>
                    <span 
                      className="px-3 py-1 rounded-lg text-xs mr-2 shadow-sm font-medium"
                      style={{
                        backgroundColor: workshopColors[choices[0]] ? `${workshopColors[choices[0]]}20` : undefined,
                        borderLeft: workshopColors[choices[0]] ? `3px solid ${workshopColors[choices[0]]}` : undefined,
                        color: workshopColors[choices[0]] || undefined
                      }}
                    >
                      1. {choices[0] || '—'}
                    </span>
                    <span 
                      className="px-3 py-1 rounded-lg text-xs shadow-sm font-medium"
                      style={{
                        backgroundColor: workshopColors[choices[1]] ? `${workshopColors[choices[1]]}20` : undefined,
                        borderLeft: workshopColors[choices[1]] ? `3px solid ${workshopColors[choices[1]]}` : undefined,
                        color: workshopColors[choices[1]] || undefined
                      }}
                    >
                      2. {choices[1] || '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AutoAssign Results + Buttons */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl p-6 shadow-sm border border-blue-200">
          <h3 className="text-lg font-semibold mb-4 text-blue-900 border-b border-blue-300 pb-2">
            Automatische Zuweisung
          </h3>

          <div className="mb-4 flex flex-wrap gap-3">
            <div className="flex flex-col gap-3">
              <label className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-blue-600 hover:to-blue-700 hover:shadow-md transition-all duration-200 cursor-pointer text-center">
              <input
                  ref={fileInputRefBand1}
                type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => handleFileUpload(e, 'erstesBand')}
                className="hidden"
              />
                📁 Erstes Band hochladen (CSV/XLSX)
            </label>
              <label className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-purple-600 hover:to-purple-700 hover:shadow-md transition-all duration-200 cursor-pointer text-center">
                <input
                  ref={fileInputRefBand2}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => handleFileUpload(e, 'zweitesBand')}
                  className="hidden"
                />
                📁 Zweites Band hochladen (CSV/XLSX)
              </label>
            </div>
            <button 
              onClick={runAutoAssign} 
              className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200"
            >
              Auto-Zuordnung starten
            </button>
          </div>

          {/* Upload Summary */}
          {uploadSummary && (
            <div className="mt-4 bg-white rounded-lg p-4 border-2 border-blue-300 shadow-md">
              <div className="flex justify-between items-center mb-3">
                <h4 className="text-lg font-semibold text-gray-800">
                  📊 Upload-Zusammenfassung {uploadSummary.band && `(${uploadSummary.band})`}
                </h4>
                <button 
                  onClick={() => setUploadSummary(null)}
                  className="text-gray-500 hover:text-gray-700 text-xl"
                >
                  ×
                </button>
              </div>
              
              <div className="space-y-3">
                {uploadSummary.newStudents.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="font-semibold text-green-800 mb-2">
                      ✅ Neue Schüler hinzugefügt ({uploadSummary.newStudents.length}):
                    </div>
                    <div className="text-sm text-green-700 max-h-32 overflow-y-auto">
                      {uploadSummary.newStudents.join(', ')}
                    </div>
                  </div>
                )}

                {uploadSummary.updatedClasses.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="font-semibold text-blue-800 mb-2">
                      🔄 Klassen aktualisiert ({uploadSummary.updatedClasses.length}):
                    </div>
                    <div className="text-sm text-blue-700 max-h-32 overflow-y-auto space-y-1">
                      {uploadSummary.updatedClasses.map((item, idx) => (
                        <div key={idx}>
                          <strong>{item.student}:</strong> {item.old || '(keine)'} → {item.new}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {uploadSummary.newWorkshops.length > 0 && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="font-semibold text-purple-800 mb-2">
                      🏫 Neue Werkstätten hinzugefügt ({uploadSummary.newWorkshops.length}):
                    </div>
                    <div className="text-sm text-purple-700 max-h-32 overflow-y-auto">
                      {uploadSummary.newWorkshops.join(', ')}
                    </div>
                  </div>
                )}

                {uploadSummary.updatedChoices > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <div className="font-semibold text-yellow-800">
                      📝 Wahlen aktualisiert: {uploadSummary.updatedChoices} Schüler
                    </div>
                  </div>
                )}

                {uploadSummary.newStudents.length === 0 && 
                 uploadSummary.updatedClasses.length === 0 && 
                 uploadSummary.newWorkshops.length === 0 && 
                 uploadSummary.updatedChoices === 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="text-sm text-gray-600">
                      Keine Änderungen erkannt.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-4">
            <button 
              onClick={finalizeAndOverwriteConfirm} 
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-medium rounded-lg shadow-sm hover:from-blue-700 hover:to-blue-800 hover:shadow-md transition-all duration-200"
            >
              Beide Bänder speichern ({getSchoolYearKey(yearTrimester.schoolYearStart, yearTrimester.schoolYearEnd, yearTrimester.trimester)})
            </button>
          </div>

          {/* Display statistics - use currentStatistics if available, otherwise autoResult */}
          {(Object.keys(dragAssignments.erstesBand).length > 0 || Object.keys(dragAssignments.zweitesBand).length > 0 || autoResult) && (
            <>
              <div className="text-gray-700 mb-3 text-sm">
                {(() => {
                  const stats = (Object.keys(dragAssignments.erstesBand).length > 0 || Object.keys(dragAssignments.zweitesBand).length > 0) 
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
                      <div className="mt-2 text-xs space-y-1">
                        <div className="font-semibold">Erstes Band:</div>
                        <div className="ml-3">
                          {stats.erstesBand.total > 0 ? (
                            <>
                              <strong>{stats.erstesBand.percentFirst.toFixed(2)}%</strong> erste Wahlen ({stats.erstesBand.num1} erste, {stats.erstesBand.num2} zweite von {stats.erstesBand.total} Zuweisungen)
                            </>
                          ) : (
                            <>Keine Zuweisungen mit Wahlen</>
                          )}
                        </div>
                        <div className="font-semibold mt-2">Zweites Band:</div>
                        <div className="ml-3">
                          {stats.zweitesBand.total > 0 ? (
                            <>
                              <strong>{stats.zweitesBand.percentFirst.toFixed(2)}%</strong> erste Wahlen ({stats.zweitesBand.num1} erste, {stats.zweitesBand.num2} zweite von {stats.zweitesBand.total} Zuweisungen)
                            </>
                          ) : (
                            <>Keine Zuweisungen mit Wahlen</>
                          )}
                        </div>
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
          
          {!autoResult && (Object.keys(dragAssignments.erstesBand).length === 0 && Object.keys(dragAssignments.zweitesBand).length === 0) && (
            <div className="text-gray-500 italic text-sm">
              Noch keine automatische Zuordnung durchgeführt.
            </div>
          )}
        </div>
      </div>

      {/* --- MID SECTION: Assignment Summary (Übersicht) --- */}
      {autoResult && (
        <div className="mt-6 bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 shadow-sm border border-green-200">
          <h3 className="text-lg font-semibold mb-4 text-green-900 border-b border-green-300 pb-2">
            Übersicht ({activeBand === 'erstesBand' ? 'Erstes' : 'Zweites'} Band)
          </h3>
          <div className="max-h-[300px] overflow-y-auto text-sm border-t border-gray-200 pt-2">
            {students.map((s) => {
              const ch = getChoicesForBand(activeBand)[s] || [];
              const assigned = getAssignmentsForBand(activeBand)[s] || 'Nicht Zugeordnet';
              const gotFirst = assigned === ch[0];
              const gotSecond = assigned === ch[1];
              const violations = checkViolationsForStudent(s, ch);
              const needsAssistant = studentAssistants[s];

              return (
                <div
                  key={s}
                  className={`flex flex-col py-3 px-3 rounded-lg border-b last:border-0 transition-all duration-200 ${
                    needsAssistant
                      ? 'bg-gradient-to-r from-blue-50 to-indigo-100 border-l-4 border-blue-400 shadow-sm'
                      : hasNoVotesForBand(s, activeBand)
                      ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border-l-4 border-yellow-400 shadow-sm'
                      : gotFirst
                      ? 'bg-gradient-to-r from-green-50 to-emerald-100 border-green-200 shadow-sm'
                      : gotSecond
                      ? 'bg-gradient-to-r from-purple-50 to-violet-100 border-purple-200 shadow-sm'
                      : assigned !== 'Nicht Zugeordnet'
                      ? 'bg-gradient-to-r from-yellow-50 to-amber-100 border-yellow-200 shadow-sm'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center">
                      <div className="font-medium">{s}</div>
                      <span className="ml-2 px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-medium rounded">
                        {studentClasses[s] || '—'}
                      </span>
                      {needsAssistant && (
                        <span className="ml-2 px-2 py-0.5 bg-blue-200 text-blue-800 text-xs font-semibold rounded-full flex items-center">
                          <div className="w-2 h-2 bg-blue-600 rounded-full mr-1"></div>
                          Lernbegleitung
                        </span>
                      )}
                      {hasNoVotesForBand(s, activeBand) && (
                        <span className="ml-2 px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs font-semibold rounded-full flex items-center">
                          <div className="w-2 h-2 bg-yellow-500 rounded-full mr-1"></div>
                          Keine Wahlen
                        </span>
                      )}
                    </div>
                    <div className="font-semibold">{assigned}</div>
                  </div>
                  {violations.length > 0 && (
                    <div className="text-xs text-red-600 mt-1">
                      {violations.map((v, idx) => (
                        <div key={idx}>{v}</div>
                      ))}
                    </div>
                  )}
                  <div className="text-xs text-gray-600 mt-2 flex gap-2">
                    <span className="px-2 py-1 bg-gray-100 rounded-md font-medium">1. {ch[0] || '—'}</span>
                    <span className="px-2 py-1 bg-gray-100 rounded-md font-medium">2. {ch[1] || '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- BOTTOM SECTION: Drag & Drop Grid --- */}
      <div className="mt-6 bg-gradient-to-br from-purple-50 to-violet-100 rounded-xl p-6 shadow-sm border border-purple-200">
        <h3 className="text-lg font-semibold mb-4 text-purple-900 border-b border-purple-300 pb-2">
          Manuelle Anpassung ({activeBand === 'erstesBand' ? 'Erstes' : 'Zweites'} Band)
        </h3>

        {/* Warning for students with same workshop in both bands */}
        {(() => {
          const conflicts = getStudentsWithSameWorkshopInBothBands();
          if (conflicts.length > 0) {
            const warningKey = 'same-workshop-both-bands';
            const isChecked = checkedWarnings[warningKey] || false;
            return (
              <div className={`mb-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 ${isChecked ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleWarningCheck(warningKey)}
                    className="mt-0.5 cursor-pointer"
                  />
                  <svg className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex-1">
                    <div className={`font-semibold text-yellow-800 mb-1 ${isChecked ? 'line-through' : ''}`}>
                      ⚠️ Warnung: {conflicts.length} Schüler {conflicts.length === 1 ? 'ist' : 'sind'} in beiden Bändern derselben Werkstatt zugeordnet
                    </div>
                    <div className="text-sm text-yellow-700 space-y-1">
                      {conflicts.map((conflict, idx) => (
                        <div key={idx} className={isChecked ? 'line-through opacity-60' : ''}>
                          <strong>{conflict.student}</strong>: {conflict.workshop} (Erstes & Zweites Band)
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* Warning for students with same first choice in both bands */}
        {(() => {
          const conflicts = getStudentsWithSameFirstChoiceInBothBands();
          if (conflicts.length > 0) {
            const warningKey = 'same-first-choice-both-bands';
            const isChecked = checkedWarnings[warningKey] || false;
            return (
              <div className={`mb-4 bg-orange-50 border-2 border-orange-400 rounded-lg p-4 ${isChecked ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleWarningCheck(warningKey)}
                    className="mt-0.5 cursor-pointer"
                  />
                  <svg className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex-1">
                    <div className={`font-semibold text-orange-800 mb-1 ${isChecked ? 'line-through' : ''}`}>
                      ⚠️ Warnung: {conflicts.length} Schüler {conflicts.length === 1 ? 'hat' : 'haben'} dieselbe erste Wahl in beiden Bändern
                    </div>
                    <div className="text-sm text-orange-700 space-y-1">
                      {conflicts.map((conflict, idx) => (
                        <div key={idx} className={isChecked ? 'line-through opacity-60' : ''}>
                          <strong>{conflict.student}</strong>: {conflict.workshop} (Erstes & Zweites Band)
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {/* Warning for students without votes - separate for each band */}
        {(() => {
          const erstesBandNoVotes = students.filter(s => hasNoVotesForBand(s, 'erstesBand'));
          const zweitesBandNoVotes = students.filter(s => hasNoVotesForBand(s, 'zweitesBand'));
          const warnings = [];
          
          if (erstesBandNoVotes.length > 0) {
            warnings.push({ band: 'erstesBand', bandLabel: 'Erstes Band', students: erstesBandNoVotes });
          }
          if (zweitesBandNoVotes.length > 0) {
            warnings.push({ band: 'zweitesBand', bandLabel: 'Zweites Band', students: zweitesBandNoVotes });
          }
          
          if (warnings.length === 0) return null;
          
          return warnings.map((warning, warningIdx) => {
            const warningKey = `no-votes-${warning.band}`;
            const isChecked = checkedWarnings[warningKey] || false;
            return (
              <div key={warningIdx} className={`mb-4 bg-amber-50 border-2 border-amber-400 rounded-lg p-4 ${isChecked ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleWarningCheck(warningKey)}
                    className="mt-0.5 cursor-pointer"
                  />
                  <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex-1">
                    <div className={`font-semibold text-amber-800 mb-1 ${isChecked ? 'line-through' : ''}`}>
                      ⚠️ {warning.students.length} Schüler {warning.students.length === 1 ? 'hat' : 'haben'} keine Wahlen abgegeben ({warning.bandLabel})
                    </div>
                    <div className={`text-sm text-amber-700 max-h-32 overflow-y-auto ${isChecked ? 'line-through opacity-60' : ''}`}>
                      {warning.students.slice(0, 10).map((student, idx) => (
                        <span key={idx}>
                          {student}
                          {idx < Math.min(warning.students.length - 1, 9) && ', '}
                        </span>
                      ))}
                      {warning.students.length > 10 && ` ... und ${warning.students.length - 10} weitere`}
                    </div>
                  </div>
                </div>
              </div>
            );
          });
        })()}

        <div className="relative">
          {/* Top scrollbar container - mirror of main content for visual scrollbar */}
          <div ref={topScrollbarRef} className="overflow-x-auto w-full mb-2" style={{ scrollbarWidth: 'thin', height: '17px' }}>
            <div className="flex gap-4" style={{ minWidth: 'max-content', width: '100%' }}>
              {Object.keys(workshops).filter(w => isWorkshopAvailableInBand(workshops, w, activeBand)).map((w) => (
                <div key={w} className="flex-shrink-0" style={{ width: `${Math.max(220, Math.min(280, windowWidth / (Object.keys(workshops).filter(w => isWorkshopAvailableInBand(workshops, w, activeBand)).length + 1) - 40))}px` }}>
                  {/* Empty div to match workshop width */}
                </div>
              ))}
              <div className="flex-shrink-0" style={{ width: `${Math.max(220, Math.min(280, windowWidth / (Object.keys(workshops).filter(w => isWorkshopAvailableInBand(workshops, w, activeBand)).length + 1) - 40))}px` }}>
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
            {Object.keys(workshops).filter(w => isWorkshopAvailableInBand(workshops, w, activeBand)).map((w) => {
              const currentCount = getCurrentWorkshopCounts()[w] || 0;
              const capacity = getWorkshopCapacity(workshops[w], w);
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
                    width: `${Math.max(220, Math.min(280, windowWidth / (Object.keys(workshops).filter(w => isWorkshopAvailableInBand(workshops, w, activeBand)).length + 1) - 40))}px`,
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
                      .filter(([s, a]) => a === w)
                      .map(([s]) => (
                        <div
                          key={s}
                          draggable
                          onDragStart={(e) => handleDragStart(e, s)}
                          className={`cursor-move px-3 py-2 rounded-lg text-xs flex justify-between items-start shadow-sm flex-col transition-all duration-200 hover:shadow-md ${
                            persistentViols[s]
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
                setDragAssignments((prev) => ({ 
                  ...prev, 
                  [activeBand]: { ...prev[activeBand], [student]: 'Nicht Zugeordnen' }
                }));
                
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
                  {students.filter(s => {
                    const assignment = getAssignmentsForBand(activeBand)[s];
                    return !assignment || assignment === 'Nicht Zugeordnet' || assignment === 'Nicht Zugeordnen';
                  }).length}
                </span>
              </div>

              <div className="space-y-1 min-h-[80px]">
                {students
                  .filter(s => {
                    const assignment = getAssignmentsForBand(activeBand)[s];
                    return !assignment || assignment === 'Nicht Zugeordnet' || assignment === 'Nicht Zugeordnen';
                  })
                  .map((s) => (
                    <div
                      key={s}
                      draggable
                      onDragStart={(e) => handleDragStart(e, s)}
                      className={`cursor-move px-3 py-2 rounded-lg text-xs shadow-sm flex flex-col transition-all duration-200 hover:shadow-md ${
                        hasNoVotesForBand(s, activeBand)
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
              </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Band Selection Buttons at Bottom */}
        <div className="flex justify-center gap-4 mt-6 pt-4 border-t border-purple-300">
          <button
            onClick={() => setActiveBand('erstesBand')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
              activeBand === 'erstesBand'
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg transform scale-105'
                : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
            }`}
          >
            Erstes Band
          </button>
          <button
            onClick={() => setActiveBand('zweitesBand')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-sm ${
              activeBand === 'zweitesBand'
                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg transform scale-105'
                : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 hover:shadow-md'
            }`}
          >
            Zweites Band
          </button>
        </div>
      </div>
    </div>
  </section>
)}

{tab === 'reports' && (
  <section className="reports-tab space-y-8">
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b border-gray-300 pb-3">Berichte herunterladen</h2>
      
      {/* School Year/Trimester Selection */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-100 rounded-xl p-6 mb-8 shadow-sm border border-indigo-200">
        <h3 className="text-lg font-semibold text-indigo-900 mb-4 border-b border-indigo-300 pb-2">Schuljahr & Trimester Auswahl</h3>
        <div className="flex flex-wrap gap-6 items-center">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Schuljahr Start:</label>
            <input 
              type="number" 
              value={reportYearTrimester.schoolYearStart} 
              onChange={(e) => {
                const start = parseInt(e.target.value) || getDefaultSchoolYear().schoolYearStart;
                setReportYearTrimester(prev => ({ ...prev, schoolYearStart: start, schoolYearEnd: start + 1 }));
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 w-32"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Schuljahr Ende:</label>
            <input 
              type="number" 
              value={reportYearTrimester.schoolYearEnd} 
              onChange={(e) => {
                const end = parseInt(e.target.value) || getDefaultSchoolYear().schoolYearEnd;
                setReportYearTrimester(prev => ({ ...prev, schoolYearEnd: end, schoolYearStart: end - 1 }));
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 w-32"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Trimester:</label>
            <select 
              value={reportYearTrimester.trimester} 
              onChange={(e) => setReportYearTrimester(prev => ({ ...prev, trimester: parseInt(e.target.value) }))}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
            >
              <option value={1}>1. Trimester</option>
              <option value={2}>2. Trimester</option>
              <option value={3}>3. Trimester</option>
            </select>
          </div>
          <div className="text-sm text-gray-600 bg-white px-4 py-2 rounded-lg border border-gray-200">
            <strong>Bericht für:</strong> {getSchoolYearKey(reportYearTrimester.schoolYearStart, reportYearTrimester.schoolYearEnd, reportYearTrimester.trimester)}
          </div>
        </div>
      </div>

      {/* Available Reports */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Workshop Overview Report */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 shadow-sm border border-green-200">
          <h3 className="text-lg font-semibold text-green-900 mb-3 border-b border-green-300 pb-2">Werkstatt-Übersicht (PDF)</h3>
          <p className="text-sm text-green-700 mb-4">
            Umfassende PDF-Übersicht aller Werkstätten mit:
          </p>
          <ul className="text-xs text-green-600 mb-4 list-disc list-inside space-y-1">
            <li>Lehrkraft und Raum pro Werkstatt</li>
            <li>Kapazität und Belegung (Erstes & Zweites Band)</li>
            <li>Alle zugeordneten Schüler mit Klasse</li>
            <li>Lernbegleitung-Status</li>
          </ul>
          <div className="space-y-2">
            <button 
              onClick={generatePDFAllWorkshopsReport}
              className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200"
            >
              📊 PDF: Alle Werkstätten (ein Dokument)
            </button>
            <button 
              onClick={generatePDFWorkshopReports}
              className="w-full px-6 py-3 bg-gradient-to-r from-green-400 to-green-500 text-white font-semibold rounded-lg shadow-sm hover:from-green-500 hover:to-green-600 hover:shadow-md transition-all duration-200"
            >
              📊 PDF: Einzelne Werkstätten (mehrere Dokumente)
            </button>
          </div>
        </div>

        {/* Class Report */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl p-6 shadow-sm border border-blue-200">
          <h3 className="text-lg font-semibold text-blue-900 mb-3 border-b border-blue-300 pb-2">Klassen-Berichte (PDF)</h3>
          <p className="text-sm text-blue-700 mb-4">
            Umfassende PDF-Berichte für alle Klassen mit:
          </p>
          <ul className="text-xs text-blue-600 mb-4 list-disc list-inside space-y-1">
            <li>Alle Schüler pro Klasse</li>
            <li>Werkstatt-Zuordnungen für beide Bänder</li>
            <li>Lernbegleitung-Status</li>
          </ul>
          <div className="space-y-2">
            <button 
              onClick={generatePDFAllClassesReport}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg shadow-sm hover:from-blue-600 hover:to-blue-700 hover:shadow-md transition-all duration-200"
            >
              📋 PDF: Alle Klassen (ein Dokument)
            </button>
            <button 
              onClick={generatePDFClassReports}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg shadow-sm hover:from-blue-500 hover:to-blue-600 hover:shadow-md transition-all duration-200"
            >
              📋 PDF: Einzelne Klassen (mehrere Dokumente)
            </button>
          </div>
        </div>
      </div>

      {/* Available Data Info */}
      <div className="mt-8 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 shadow-sm border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-3 border-b border-gray-300 pb-2">Verfügbare Daten</h3>
        <div className="text-sm text-gray-600">
          <p className="mb-2">Folgende Jahr/Trimester-Kombinationen sind verfügbar:</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(confirmedAssignments).length > 0 ? (
              Object.keys(confirmedAssignments).map(key => (
                <span key={key} className="px-3 py-1 bg-white rounded-lg border border-gray-200 text-xs font-medium">
                  {key}
                </span>
              ))
            ) : (
              <span className="text-gray-500 italic">Keine Daten verfügbar</span>
            )}
          </div>
        </div>
      </div>

    </div>
  </section>
)}

      {tab === 'workshops' && (
        <section className="section">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl p-6 shadow-sm border border-blue-200">
                <h3 className="text-xl font-semibold text-blue-900 mb-4 border-b border-blue-300 pb-3">Aktive Werkstätten</h3>
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {Object.entries(workshops).map(([name, workshop]) => {
                    const cap = getWorkshopCapacity(workshop, name);
                    const availableBands = getWorkshopAvailableBands(workshop, name);
                    return (
                    <div key={name} className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200">
                      <div className="workshop-info mb-3">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="text-lg font-semibold text-gray-800 flex-1">{name}</div>
                          <ColorPicker 
                            currentColor={workshopColors[name] || ''} 
                            usedColors={Object.values(workshopColors)}
                            allWorkshopColors={workshopColors}
                            onColorChange={(color) => updateWorkshopColor(name, color)}
                          />
                        </div>
                        <div className="text-sm text-gray-600 mb-2">Kapazität: <span className="font-semibold text-blue-600">{cap}</span></div>
                        <div className="text-sm text-gray-600 mb-2">
                          <label className="block mb-1">Verfügbar in:</label>
                          <div className="flex gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={availableBands.includes('erstesBand')}
                                onChange={(e) => {
                                  const newBands = e.target.checked
                                    ? [...availableBands.filter(b => b !== 'erstesBand'), 'erstesBand']
                                    : availableBands.filter(b => b !== 'erstesBand');
                                  updateWorkshopAvailableBands(name, newBands.length > 0 ? newBands : ['zweitesBand']);
                                }}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span>Erstes Band</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={availableBands.includes('zweitesBand')}
                                onChange={(e) => {
                                  const newBands = e.target.checked
                                    ? [...availableBands.filter(b => b !== 'zweitesBand'), 'zweitesBand']
                                    : availableBands.filter(b => b !== 'zweitesBand');
                                  updateWorkshopAvailableBands(name, newBands.length > 0 ? newBands : ['erstesBand']);
                                }}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span>Zweites Band</span>
                            </label>
                          </div>
                        </div>
                        <div className="text-sm text-gray-600 mb-2">
                          <label className="block mb-1">Lehrer:</label>
                          <input 
                            type="text" 
                            value={workshopTeachers[name] || ''} 
                            onChange={e => updateWorkshopTeacher(name, e.target.value)} 
                            placeholder="Lehrer eingeben"
                            className="px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 w-full text-sm" 
                          />
                        </div>
                        <div className="text-sm text-gray-600 mb-2">
                          <label className="block mb-1">Raumnummer:</label>
                          <input 
                            type="text" 
                            value={workshopRooms[name] || ''} 
                            onChange={e => updateWorkshopRoom(name, e.target.value)} 
                            placeholder="Raumnummer eingeben"
                            className="px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 w-full text-sm" 
                          />
                        </div>
                        {prereqs[name] && prereqs[name].length > 0 && (
                          <div className="text-sm text-gray-600 mb-2">
                            Voraussetzungen: <span className="font-medium text-orange-600">{prereqs[name].join(', ')}</span>
                          </div>
                        )}
                        {cannotBeParallel[name] && cannotBeParallel[name].length > 0 && (
                          <div className="text-sm text-gray-600">
                            Nicht parallel belegbar mit: <span className="font-medium text-red-600">{cannotBeParallel[name].join(', ')}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input 
                          type="number" 
                          value={cap} 
                          onChange={e=>updateWorkshopCapacity(name, e.target.value)} 
                          className="px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 w-20" 
                        />
                        <button 
                          onClick={() => handleWorkshopClick(name)} 
                          className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200"
                        >
                          Voraussetzungen
                        </button>
                        <button 
                          onClick={() => handleCannotBeParallelClick(name)} 
                          className="px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-orange-600 hover:to-orange-700 hover:shadow-md transition-all duration-200"
                        >
                          Nicht parallel
                        </button>
                        <button 
                          onClick={()=>deleteWorkshop(name)} 
                          className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-red-600 hover:to-red-700 hover:shadow-md transition-all duration-200"
                        >
                          Löschen
                        </button>
                      </div>
                    </div>
                    );
                  })}
                  {Object.keys(workshops).length === 0 && (
                    <div className="text-gray-500 italic p-4 bg-gray-50 rounded-lg text-center">
                      Keine aktiven Werkstätten.
                    </div>
                  )}
                </div>
                
                {/* Archived Workshops Section */}
                {Object.keys(archivedWorkshops).length > 0 && (
                  <div className="mt-6 pt-6 border-t border-gray-300">
                    <h3 className="text-lg font-semibold text-gray-700 mb-4">Archivierte Werkstätten</h3>
                    <div className="space-y-4 max-h-96 overflow-y-auto">
                      {Object.entries(archivedWorkshops).map(([name, data]) => (
                        <div key={name} className="bg-gray-100 rounded-lg p-4 shadow-sm border border-gray-300 opacity-75">
                          <div className="workshop-info mb-3">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="text-lg font-semibold text-gray-600 flex-1">{name}</div>
                              <span className="text-xs px-2 py-1 bg-gray-400 text-white rounded-full">Archiviert</span>
                              <ColorPicker 
                                currentColor={workshopColors[name] || ''} 
                                usedColors={Object.values(workshopColors)}
                                allWorkshopColors={workshopColors}
                                onColorChange={(color) => updateWorkshopColor(name, color)}
                              />
                            </div>
                            <div className="text-sm text-gray-600 mb-2">Kapazität: <span className="font-semibold text-gray-600">{data.capacity}</span></div>
                            <div className="text-xs text-gray-500 mb-2">
                              Archiviert am: {new Date(data.archivedAt).toLocaleDateString('de-DE')}
                            </div>
                            {workshopTeachers[name] && (
                              <div className="text-sm text-gray-600 mb-2">Lehrer: <span className="font-semibold text-gray-600">{workshopTeachers[name]}</span></div>
                            )}
                            {workshopRooms[name] && (
                              <div className="text-sm text-gray-600 mb-2">Raum: <span className="font-semibold text-gray-600">{workshopRooms[name]}</span></div>
                            )}
                            {prereqs[name] && prereqs[name].length > 0 && (
                              <div className="text-sm text-gray-600">
                                Voraussetzungen: <span className="font-medium text-gray-600">{prereqs[name].join(', ')}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button 
                              onClick={() => reactivateWorkshop(name)} 
                              className="px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200"
                            >
                              Reaktivieren
                            </button>
                            <button 
                              onClick={() => permanentlyDeleteArchivedWorkshop(name)} 
                              className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-red-600 hover:to-red-700 hover:shadow-md transition-all duration-200"
                            >
                              Endgültig löschen
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 shadow-sm border border-green-200">
                <h3 className="text-xl font-semibold text-green-900 mb-4 border-b border-green-300 pb-3">Neue Werkstatt hinzufügen</h3>
                <AddWorkshopForm onAdd={(n,c)=>addWorkshop(n,c)} />
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'rules' && (
        <section className="section">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gradient-to-br from-purple-50 to-violet-100 rounded-xl p-6 shadow-sm border border-purple-200">
                <h3 className="text-xl font-semibold text-purple-900 mb-4 border-b border-purple-300 pb-3">Aktuelle Regeln</h3>
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {rules.length===0 && (
                    <div className="text-gray-500 italic p-4 bg-gray-50 rounded-lg text-center">
                      Keine Regeln definiert.
                    </div>
                  )}
                  {rules.map(r => {
                    const ruleType = r.type || "belegung"; // Default to belegung for backward compatibility
                    return (
                      <div key={r.id} className="bg-white rounded-lg p-4 shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <div className="rule-name text-lg font-semibold text-gray-800">{r.name}</div>
                              <span className={`text-xs px-2 py-1 rounded-full ${ruleType === "belegung" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>
                                {ruleType === "belegung" ? "Belegung" : "Folgekurs"}
                              </span>
                            </div>
                            {ruleType === "belegung" ? (
                              <div className="rule-description text-sm text-gray-600 mb-2">
                                <span className="font-medium text-orange-600">{(r.options || []).join(', ')}</span>
                              </div>
                            ) : (
                              <div className="rule-description text-sm text-gray-600 mb-2">
                                <span className="font-medium text-green-600">
                                  {r.fromCourse} → {r.toCourse}
                                  {r.sameBand && <span className="text-xs text-gray-500 ml-2">(gleiches Band)</span>}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="group relative inline-block ml-2">
                            <svg className="w-5 h-5 text-blue-500 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="absolute right-0 bottom-full mb-2 transform w-64 bg-gray-900 text-white text-xs rounded-lg py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                              <strong>Was bedeutet diese Regel?</strong><br/>
                              {ruleType === "belegung" ? (
                                <>Der Schüler muss <strong>alle</strong> aufgelisteten Kurse irgendwann einmal belegt haben. Die Regel ist erfüllt, wenn der Schüler in seiner Historie alle Kurse ({(r.options || []).join(', ')}) mindestens einmal zugeordnet bekommen hat.</>
                              ) : (
                                <>Wenn ein Schüler den Kurs <strong>{r.fromCourse}</strong> in einem Trimester belegt, muss er im nächsten Trimester automatisch den Kurs <strong>{r.toCourse}</strong> belegen{r.fromCourse === r.toCourse ? " (derselbe Kurs)" : ""}.{r.sameBand ? " Der Folgekurs muss im selben Band (Erstes oder Zweites Band) wie der Ausgangskurs sein." : ""}</>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="rule-controls">
                          <button 
                            onClick={()=>deleteRule(r.id)} 
                            className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-sm font-medium rounded-lg shadow-sm hover:from-red-600 hover:to-red-700 hover:shadow-md transition-all duration-200"
                          >
                            Regel löschen
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="bg-gradient-to-br from-orange-50 to-amber-100 rounded-xl p-6 shadow-sm border border-orange-200">
                <h3 className="text-xl font-semibold text-orange-900 mb-4 border-b border-orange-300 pb-3">Neue Regel erstellen</h3>
                <CreateRuleForm workshops={Object.keys(workshops)} onAdd={addRule} />
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'data' && (
        <section className="section">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b border-gray-300 pb-3">Datenverwaltung</h2>
            
            <div className="space-y-6">
              {/* Export Section */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-6 shadow-sm border border-green-200">
                <h3 className="text-xl font-semibold text-green-900 mb-4 border-b border-green-300 pb-3">Daten exportieren</h3>
                <p className="text-sm text-green-700 mb-4">
                  Exportieren Sie alle Daten als ZIP-Datei. Die Datei wird mit dem aktuellen Datum und der Uhrzeit benannt.
                </p>
                <button
                  onClick={handleExportAllData}
                  className="px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-lg shadow-sm hover:from-green-600 hover:to-green-700 hover:shadow-md transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Alle Daten als ZIP exportieren
                </button>
              </div>

              {/* Import Section */}
              <div className="bg-gradient-to-br from-blue-50 to-cyan-100 rounded-xl p-6 shadow-sm border border-blue-200">
                <h3 className="text-xl font-semibold text-blue-900 mb-4 border-b border-blue-300 pb-3">Daten importieren</h3>
                <p className="text-sm text-blue-700 mb-4">
                  Importieren Sie eine zuvor exportierte ZIP-Datei. Alle aktuellen Daten werden überschrieben.
                </p>
                <label className="block">
                  <input
                    type="file"
                    accept=".zip"
                    onChange={handleImportData}
                    className="hidden"
                    id="import-file-input"
                  />
                  <span className="inline-block px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-lg shadow-sm hover:from-blue-600 hover:to-blue-700 hover:shadow-md transition-all duration-200 cursor-pointer flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    ZIP-Datei auswählen und importieren
                  </span>
                </label>
              </div>

              {/* Clear Data Section */}
              <div className="bg-gradient-to-br from-red-50 to-rose-100 rounded-xl p-6 shadow-sm border border-red-200">
                <h3 className="text-xl font-semibold text-red-900 mb-4 border-b border-red-300 pb-3">Alle Daten löschen</h3>
                <p className="text-sm text-red-700 mb-4">
                  <strong>Warnung:</strong> Diese Aktion löscht alle Daten unwiderruflich. Stellen Sie sicher, dass Sie zuvor alle Daten exportiert haben.
                </p>
                <button
                  onClick={handleClearAllData}
                  className="px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-lg shadow-sm hover:from-red-600 hover:to-red-700 hover:shadow-md transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Alle Daten löschen
                </button>
              </div>

              {/* Data Summary */}
              <div className="bg-gradient-to-br from-gray-50 to-slate-100 rounded-xl p-6 shadow-sm border border-gray-200">
                <h3 className="text-xl font-semibold text-gray-900 mb-4 border-b border-gray-300 pb-3">Datenübersicht</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Schüler</div>
                    <div className="text-2xl font-bold text-gray-800">{students.length}</div>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Werkstätten</div>
                    <div className="text-2xl font-bold text-gray-800">{Object.keys(workshops).length}</div>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Gespeicherte Zuweisungen</div>
                    <div className="text-2xl font-bold text-gray-800">{Object.keys(confirmedAssignments).length}</div>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Regeln</div>
                    <div className="text-2xl font-bold text-gray-800">{rules.length}</div>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Vorherige Zuweisungen</div>
                    <div className="text-2xl font-bold text-gray-800">{Object.keys(prevAssignments).length}</div>
                  </div>
                  <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Voraussetzungen</div>
                    <div className="text-2xl font-bold text-gray-800">{Object.keys(prereqs).length}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

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

      <footer className="app-footer">2025 Jasper Wilfling</footer>

    </div>
  );
}

// ----------------------------
// Subcomponents
// ----------------------------
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

function CreateRuleForm({ workshops, onAdd }) {
  const [ruleType, setRuleType] = useState("belegung"); // "belegung" or "folgekurs"
  const [name, setName] = useState("");
  const [selected, setSelected] = useState([]); // for belegung rules
  const [fromCourse, setFromCourse] = useState(""); // for folgekurs rules
  const [toCourse, setToCourse] = useState(""); // for folgekurs rules
  const [sameBand, setSameBand] = useState(false); // for folgekurs rules

  function toggleOpt(opt) {
    setSelected(prev => prev.includes(opt) ? prev.filter(x=>x!==opt) : [...prev, opt]);
  }

  function submit() {
    if (!name) {
      alert('Bitte einen Regel-Namen eingeben.');
      return;
    }
    
    if (ruleType === "belegung") {
      if (selected.length === 0) {
        alert('Bitte mindestens eine Option wählen.');
        return;
      }
      onAdd({ type: "belegung", name, options: selected });
      setName(""); setSelected([]);
    } else if (ruleType === "folgekurs") {
      if (!fromCourse || !toCourse) {
        alert('Bitte sowohl Ausgangskurs als auch Folgekurs auswählen.');
        return;
      }
      // Allow fromCourse === toCourse (student must take the same course again)
      onAdd({ type: "folgekurs", name, fromCourse, toCourse, sameBand });
      setName(""); setFromCourse(""); setToCourse(""); setSameBand(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Regel-Typ</label>
        <select 
          value={ruleType} 
          onChange={e=>setRuleType(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
        >
          <option value="belegung">Belegungsregel</option>
          <option value="folgekurs">Folgekurs-Regel</option>
        </select>
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Regel-Name</label>
        <input 
          placeholder="Regel-Name" 
          value={name} 
          onChange={e=>setName(e.target.value)} 
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200" 
        />
      </div>

      {ruleType === "belegung" ? (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Wähle mögliche Kurse (mindestens eine):</label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {workshops.map(w => (
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-xs text-blue-700">
                <strong>Hinweis:</strong> Diese Regel bedeutet, dass der Schüler <strong>alle</strong> ausgewählten Kurse irgendwann einmal belegt haben muss. Die Regel ist erfüllt, wenn der Schüler in seiner gesamten Historie alle Kurse mindestens einmal zugeordnet bekommen hat.
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ausgangskurs (wenn Schüler diesen Kurs belegt):</label>
            <select 
              value={fromCourse} 
              onChange={e=>setFromCourse(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all duration-200"
            >
              <option value="">-- Ausgangskurs wählen --</option>
              {workshops.map(w => (
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
              {workshops.map(w => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center p-3 bg-white rounded-lg border border-gray-200">
            <input 
              type="checkbox" 
              id="sameBand"
              checked={sameBand} 
              onChange={e=>setSameBand(e.target.checked)}
              className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500"
            />
            <label htmlFor="sameBand" className="ml-2 text-sm font-medium text-gray-700 cursor-pointer">
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
      )}
      
      <button 
        onClick={submit} 
        className="w-full px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-lg shadow-sm hover:from-orange-600 hover:to-orange-700 hover:shadow-md transition-all duration-200"
      >
        Regel erstellen
      </button>
    </div>
  );
}

// NEW: StudentHistoryTable – shows confirmedAssignments for a given student and allows inline edit
function StudentHistoryTable({ student, confirmedAssignments, workshops, onChangeAssignment, archivedWorkshops = {} }) {
  const slots = Object.entries(confirmedAssignments).map(([slotKey, payload]) => {
    // Check if this is a multi-Band assignment
    if (payload.bands && payload.bands.includes('erstesBand') && payload.bands.includes('zweitesBand')) {
      const erstesBandAssigned = payload.assignments.erstesBand && payload.assignments.erstesBand[student] ? payload.assignments.erstesBand[student] : 'Nicht Zugeordnet';
      const zweitesBandAssigned = payload.assignments.zweitesBand && payload.assignments.zweitesBand[student] ? payload.assignments.zweitesBand[student] : 'Nicht Zugeordnet';
      return { 
        slotKey, 
        timestamp: payload.timestamp, 
        assigned: `${erstesBandAssigned} / ${zweitesBandAssigned}`,
        erstesBand: erstesBandAssigned,
        zweitesBand: zweitesBandAssigned,
        isMultiBand: true
      };
    } else {
      // Legacy single assignment format
      return { 
        slotKey, 
        timestamp: payload.timestamp, 
        assigned: payload.assignments ? payload.assignments[student] || 'Nicht Zugeordnet' : 'Nicht Zugeordnet',
        isMultiBand: false
      };
    }
  });
  
  // sort descending by slotKey
  slots.sort((a,b)=> a.slotKey < b.slotKey ? 1 : -1);

  if (slots.length === 0) return (
    <div className="text-gray-500 italic p-4 bg-gray-50 rounded-lg text-center">
      Keine historischen Zuordnungen verfügbar.
    </div>
  );

  return (
    <div className="overflow-auto bg-white rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-800 border-b border-gray-200">Jahr-Trimester</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-800 border-b border-gray-200">Erstes Band</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-800 border-b border-gray-200">Zweites Band</th>
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
              <td className="px-4 py-3 border-b border-gray-100">
                {s.isMultiBand ? (
                  <div className="flex items-center gap-2">
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      s.erstesBand === 'Nicht Zugeordnet' ? 'bg-gray-100 text-gray-600' : 
                      archivedWorkshops[s.erstesBand] ? 'bg-gray-200 text-gray-700 opacity-75' : 
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {s.erstesBand}
                    </div>
                    {archivedWorkshops[s.erstesBand] && (
                      <span className="text-xs text-gray-500" title="Archivierte Werkstatt">📦</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      s.assigned === 'Nicht Zugeordnet' ? 'bg-gray-100 text-gray-600' : 
                      archivedWorkshops[s.assigned] ? 'bg-gray-200 text-gray-700 opacity-75' : 
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {s.assigned || 'Nicht Zugeordnet'}
                    </div>
                    {archivedWorkshops[s.assigned] && (
                      <span className="text-xs text-gray-500" title="Archivierte Werkstatt">📦</span>
                    )}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 border-b border-gray-100">
                {s.isMultiBand ? (
                  <div className="flex items-center gap-2">
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      s.zweitesBand === 'Nicht Zugeordnet' ? 'bg-gray-100 text-gray-600' : 
                      archivedWorkshops[s.zweitesBand] ? 'bg-gray-200 text-gray-700 opacity-75' : 
                      'bg-green-100 text-green-800'
                    }`}>
                      {s.zweitesBand}
                    </div>
                    {archivedWorkshops[s.zweitesBand] && (
                      <span className="text-xs text-gray-500" title="Archivierte Werkstatt">📦</span>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-400 text-xs">—</div>
                )}
              </td>
              <td className="px-4 py-3 border-b border-gray-100">
                {s.isMultiBand ? (
                  <div className="space-y-2">
                    <div>
                      <div className="text-xs text-gray-600 mb-1 font-medium">Erstes Band:</div>
                      <select 
                        value={s.erstesBand} 
                        onChange={(e)=>onChangeAssignment(s.slotKey, student, e.target.value, 'erstesBand')} 
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                      >
                        <option value={'Nicht Zugeordnet'}>Nicht Zugeordnet</option>
                        {workshops.map(w => (
                          <option key={w} value={w}>{w}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1 font-medium">Zweites Band:</div>
                      <select 
                        value={s.zweitesBand} 
                        onChange={(e)=>onChangeAssignment(s.slotKey, student, e.target.value, 'zweitesBand')} 
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                      >
                        <option value={'Nicht Zugeordnet'}>Nicht Zugeordnet</option>
                        {workshops.map(w => (
                          <option key={w} value={w}>{w}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <select 
                    value={s.assigned} 
                    onChange={(e)=>onChangeAssignment(s.slotKey, student, e.target.value)} 
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                  >
                    <option value={'Nicht Zugeordnet'}>Nicht Zugeordnet</option>
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
