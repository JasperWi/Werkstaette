import React, { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  jahrgangColor,
  getNodeStatusForJahrgang,
  buildStudentFlowDetail,
  getBandAggregateState,
  getTrimesterDataPhase,
  getBandDataPhase,
} from '../studentFlowHelpers';
import { getPlanBandIds } from '../trimesterPlans';

const BAND_LABEL = {
  erstesBand: '1. Band',
  zweitesBand: '2. Band',
  drittesBand: '3. Band',
  viertesBand: '4. Band',
  fuenftesBand: '5. Band',
  sechstesBand: '6. Band',
};

const ALL_BAND_ORDER = ['erstesBand', 'zweitesBand', 'drittesBand', 'viertesBand', 'fuenftesBand', 'sechstesBand'];

function bandIndex(bandId) {
  return ALL_BAND_ORDER.indexOf(bandId);
}

function countNoun(n, singular, plural) {
  const value = Number(n) || 0;
  return `${value} ${value === 1 ? singular : plural}`;
}

function RequirementBox({ title, tone, options, conjunction }) {
  const tones = {
    or: {
      box: 'border-teal-300 bg-teal-50/80',
      title: 'text-teal-800',
      chip: 'bg-white text-teal-950 ring-teal-200',
      join: 'text-teal-700',
    },
    pick: {
      box: 'border-amber-300 bg-amber-50/80',
      title: 'text-amber-900',
      chip: 'bg-white text-amber-950 ring-amber-200',
      join: 'text-amber-800',
    },
  };
  const style = tones[tone] || tones.pick;
  return (
    <div className={`rounded-lg border-2 px-2 py-1.5 ${style.box}`}>
      <p className={`mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${style.title}`}>{title}</p>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((option, index) => (
          <React.Fragment key={option}>
            {index > 0 && conjunction ? (
              <span className={`text-[11px] font-semibold ${style.join}`}>{conjunction}</span>
            ) : null}
            <span className={`rounded-md px-2 py-0.5 font-medium ring-1 ${style.chip}`}>{option}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function freedomCopy(free, slots) {
  if (free < 0 && !(slots > 0)) return 'Keine Wahl mehr';
  if (free < 0) return slots === 1 ? 'Nur noch 1 Wahl' : `Nur noch ${slots} Wahlen`;
  if (free === 0) return 'Keine';
  if (free === 1) return '1 Wahl';
  return `${free} Wahlen`;
}

function freeGroupTitle(count) {
  if (count === 0) return 'Keine freie Wahl';
  if (count === 1) return '1 freie Wahl';
  return `${count} freie Wahlen`;
}

function describeNextTrimester(plan) {
  let trimester = Number(plan?.trimester) + 1;
  let start = plan?.schoolYearStart;
  let end = plan?.schoolYearEnd;
  if (!Number.isFinite(trimester)) trimester = 1;
  if (trimester > 3) {
    start = plan?.schoolYearEnd;
    end = Number(start) + 1;
    trimester = 1;
  }
  const year = Number.isFinite(Number(start)) && Number.isFinite(Number(end)) ? `${start}/${end}` : '';
  return {
    label: `T${trimester} öffnen`,
    year,
    title: year ? `Trimester ${trimester} (${year}) öffnen` : `Trimester ${trimester} öffnen`,
  };
}

const TRIMESTER_PHASE_HINT = {
  planned: 'Nur Trimester-Plan — noch keine Wahl- oder Zuordnungsdaten',
  choices: 'Wahl-Dateien hochgeladen, Zuordnung noch offen',
  assignments: 'Zuordnung vorhanden',
  both: 'Wahl und Zuordnung vorhanden',
};

const COL_W = 176;
const GAP = 128;
const BOX_W = 88;
const BOX_GAP = 14;
const THICK = 7;
const THIN = 2;
const TAPER = 18;
const HEADER_H = 112;
const FRAME_TOP = 48;
const NODE_W = 46;
const NODE_H = 22;
const ADD_W = 116;
const PAD_Y = 18;

function bandTitle(plan, bandId) {
  const base = BAND_LABEL[bandId] || 'Band';
  const custom = plan.bandSubtitles?.[bandId]?.trim();
  return custom && custom !== base ? `${base} (${custom})` : base;
}

function flowCurve(x0, y0, x1, y1) {
  const dx = Math.max(36, Math.abs(x1 - x0) * 0.5);
  const dir = x1 >= x0 ? 1 : -1;
  return `M ${x0} ${y0} C ${x0 + dir * dx} ${y0}, ${x1 - dir * dx} ${y1}, ${x1} ${y1}`;
}

function taper(xThick, xThin, y) {
  const dir = xThin >= xThick ? 1 : -1;
  const span = Math.abs(xThin - xThick);
  const run = Math.min(TAPER, span);
  const xEnd = xThick + dir * run;
  const halfThick = THICK / 2;
  const halfThin = THIN / 2;
  return {
    path: `M ${xThick} ${y - halfThick} L ${xEnd} ${y - halfThin} L ${xEnd} ${y + halfThin} L ${xThick} ${y + halfThick} Z`,
    xEnd,
  };
}

const LINE_TOP = 32;
const LINE_PITCH = THICK - 1;

function boxHeight(lineCount) {
  const count = Math.max(1, lineCount);
  return LINE_TOP + THICK / 2 + (count - 1) * LINE_PITCH + 12;
}

function lineOffsets(count) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => LINE_TOP + index * LINE_PITCH);
}

function separateBundles(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || b.year - a.year);
  sorted.forEach((item, index) => {
    if (index === 0) return;
    const min = sorted[index - 1].y + NODE_H + 10;
    if (item.y < min) item.y = min;
  });
  if (sorted.length && sorted[0].y < 20) {
    const shift = 20 - sorted[0].y;
    sorted.forEach(item => {
      item.y += shift;
    });
  }
  return sorted;
}

function voteMark(phases) {
  if (!phases.length || phases.every(phase => phase === 'planned')) return 'plan';
  if (phases.some(phase => phase === 'planned')) return 'open';
  return 'voted';
}

function FlowBoard({
  plans,
  jahrgange,
  bandVisual,
  selection,
  onSelectMerge,
  selectedPlanKey,
  selectedBand,
  onSelectPlan,
  onSelectBand,
  onInsertTrimesterAfter,
  confirmedAssignments,
  loadChoicesForKey,
}) {
  const model = useMemo(() => {
    const bandPhase = (plan, bandId) =>
      getBandDataPhase(plan, bandId, confirmedAssignments, loadChoicesForKey);

    const activeYears = jahrgange.filter(year =>
      plans.some(plan => getPlanBandIds(plan).some(bandId => bandVisual(year, plan, bandId).flows))
    );

    const reached = {};
    activeYears.forEach(year => {
      let openHit = false;
      reached[year] = plans.map(plan => {
        if (openHit) return [];
        const bands = getPlanBandIds(plan).filter(bandId => bandVisual(year, plan, bandId).flows);
        if (!bands.length) return [];
        if (bands.some(bandId => bandPhase(plan, bandId) === 'planned')) openHit = true;
        return bands;
      });
    });

    const laneCount = Math.max(0, ...plans.map(plan => getPlanBandIds(plan).length));
    const laneH = Array.from({ length: laneCount }, (_, lane) => {
      let height = boxHeight(0);
      plans.forEach((plan, index) => {
        const bandId = getPlanBandIds(plan)[lane];
        if (!bandId) return;
        const people = activeYears.filter(year => reached[year][index].includes(bandId));
        height = Math.max(height, boxHeight(people.length));
      });
      return height;
    });
    const laneTop = [];
    let cursor = PAD_Y;
    laneH.forEach(height => {
      laneTop.push(cursor);
      cursor += height + BOX_GAP;
    });
    const stackBottom = laneCount ? cursor - BOX_GAP : PAD_Y;

    const columns = plans.map((plan, index) => {
      const boxes = getPlanBandIds(plan).map((bandId, lane) => {
        const people = activeYears.filter(year => reached[year][index].includes(bandId));
        const top = laneTop[lane];
        const height = laneH[lane];
        const offsets = lineOffsets(people.length);
        const lineY = {};
        people.forEach((year, personIndex) => {
          lineY[year] = top + offsets[personIndex];
        });
        return {
          bandId,
          people,
          top,
          height,
          lineY,
          phase: bandPhase(plan, bandId),
        };
      });
      const phases = boxes.map(box => box.phase);
      return { plan, index, boxes, mark: voteMark(phases) };
    });

    const colX = index => index * (COL_W + GAP);
    const nodes = [];
    for (let index = 0; index < plans.length - 1; index += 1) {
      const drafts = [];
      activeYears.forEach(year => {
        const left = reached[year][index];
        const right = reached[year][index + 1];
        if (!left.length || !right.length) return;
        const ys = [];
        columns[index].boxes.forEach(box => {
          if (box.lineY[year] != null) ys.push(box.lineY[year]);
        });
        columns[index + 1].boxes.forEach(box => {
          if (box.lineY[year] != null) ys.push(box.lineY[year]);
        });
        const y = ys.length ? ys.reduce((sum, value) => sum + value, 0) / ys.length : PAD_Y + 24;
        drafts.push({
          year,
          y,
          left,
          right,
          leftPlan: plans[index],
          rightPlan: plans[index + 1],
          x: colX(index) + COL_W + GAP / 2,
        });
      });
      separateBundles(drafts).forEach(node => nodes.push(node));
    }

    const nodeBottom = nodes.reduce((max, node) => Math.max(max, node.y + NODE_H / 2 + 16), 0);
    const bodyH = Math.max(stackBottom + PAD_Y, nodeBottom, 72);
    const chartW = plans.length * COL_W + Math.max(0, plans.length - 1) * GAP;
    const showAdd = Boolean(onInsertTrimesterAfter && plans.length);
    const totalW = chartW + (showAdd ? 16 + ADD_W : 12);

    return { activeYears, columns, nodes, bodyH, chartW, totalW, showAdd, colX };
  }, [plans, jahrgange, bandVisual, confirmedAssignments, loadChoicesForKey, onInsertTrimesterAfter]);

  const groups = useMemo(() => {
    const list = [];
    plans.forEach((plan, index) => {
      const last = list[list.length - 1];
      if (last && last.schoolYearStart === plan.schoolYearStart) {
        last.end = index;
        return;
      }
      list.push({
        key: `year-${plan.key}`,
        schoolYearStart: plan.schoolYearStart,
        label: `${plan.schoolYearStart}/${plan.schoolYearEnd}`,
        start: index,
        end: index,
      });
    });
    return list;
  }, [plans]);

  const { colX } = model;
  const scrollerRef = useRef(null);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [model.chartW, model.totalW]);

  return (
    <div className="flex items-start">
      <div className="sticky left-0 z-20 w-[7.25rem] shrink-0 self-stretch border-r-2 border-slate-400 bg-slate-100">
        <div className="flex items-end px-4 pb-3" style={{ height: HEADER_H }}>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Jahrgang</span>
        </div>
        <div className="space-y-1 px-3 py-3">
          {model.activeYears.map(year => {
            const color = jahrgangColor(year);
            const selectedRow = selection?.year === year;
            const dim = Boolean(selection && !selectedRow);
            return (
              <div key={year} className="flex items-center gap-2" style={{ opacity: dim ? 0.35 : 1 }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                <span className={`text-sm font-semibold tabular-nums ${selectedRow ? 'text-slate-950' : 'text-slate-800'}`}>
                  {year}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div ref={scrollerRef} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
        <div className="relative" style={{ width: model.totalW, minWidth: '100%' }}>
          {model.columns.map(column => {
            const { plan, index, mark, boxes } = column;
            const selected = selectedPlanKey === plan.key;
            const plannedOnly = mark === 'plan';
            const partial = mark === 'open';
            const last = boxes[boxes.length - 1];
            const frameTop = FRAME_TOP;
            const frameBottom = last ? HEADER_H + last.top + last.height + 14 : HEADER_H - 8;
            return (
              <div
                key={`frame-${plan.key}`}
                aria-hidden
                className={`pointer-events-none absolute rounded-xl ${
                  selected ? 'bg-teal-100' : plannedOnly ? 'bg-amber-100' : partial ? 'bg-amber-50' : 'bg-slate-200'
                }`}
                style={{
                  left: colX(index) + 6,
                  width: COL_W - 12,
                  top: frameTop,
                  height: Math.max(50, frameBottom - frameTop),
                }}
              />
            );
          })}
          <div className="relative z-[1]" style={{ height: HEADER_H }}>
            {groups.map(group => {
              const left = colX(group.start);
              const width = colX(group.end) + COL_W - left;
              return (
                <div
                  key={group.key}
                  className="absolute flex items-center gap-2.5 pr-3"
                  style={{ left, width, top: 2 }}
                >
                  <span className="inline-flex h-9 shrink-0 items-center rounded-md bg-slate-200 px-3 text-lg font-bold tracking-tight text-slate-900">
                    {group.label}
                  </span>
                  <span className="h-[3px] min-w-6 flex-1 rounded-full bg-slate-700" />
                </div>
              );
            })}

            {model.columns.map(column => {
              const { plan, index, mark } = column;
              const selected = selectedPlanKey === plan.key;
              const plannedOnly = mark === 'plan';
              const partial = mark === 'open';
              const phase = getTrimesterDataPhase(plan, confirmedAssignments, loadChoicesForKey);
              return (
                <button
                  key={plan.key}
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  title={`Schuljahr ${plan.schoolYearStart}/${plan.schoolYearEnd}, Trimester ${plan.trimester}. ${
                    plannedOnly
                      ? 'Noch keine Wahl hochgeladen — nur geplant.'
                      : partial
                        ? 'Mindestens ein Band hat noch keine hochgeladene Wahl.'
                        : TRIMESTER_PHASE_HINT[phase]
                  } Zum Bearbeiten klicken.`}
                  onClick={() => onSelectPlan?.(plan)}
                  className={`absolute z-[1] flex flex-col justify-center rounded-xl border border-transparent bg-transparent px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
                    onSelectPlan ? 'cursor-pointer' : 'cursor-default'
                  }`}
                  style={{ left: colX(index) + 6, width: COL_W - 12, top: 50, height: 54 }}
                >
                  <span className={`block text-[15px] font-semibold tracking-tight ${selected ? 'text-teal-950' : 'text-slate-900'}`}>
                    T{plan.trimester}
                    {plannedOnly && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Plan</span>
                    )}
                    {partial && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Offen</span>
                    )}
                  </span>
                  <span className={`mt-0.5 block whitespace-nowrap text-[11px] leading-4 ${selected ? 'text-teal-800' : 'text-slate-500'}`}>
                    {countNoun(plan.bandCount || getPlanBandIds(plan).length, 'Band', 'Bänder')}
                    <span className="text-slate-300"> · </span>
                    {countNoun(plan.wahlCount ?? 2, 'Wahl', 'Wahlen')}
                  </span>
                </button>
              );
            })}

            {model.showAdd && (
              <div className="absolute" style={{ left: model.chartW + 16, width: ADD_W, top: 50, height: 54 }}>
                {(() => {
                  const next = describeNextTrimester(plans[plans.length - 1]);
                  return (
                    <button
                      type="button"
                      title={next.title}
                      onClick={() => onInsertTrimesterAfter(plans[plans.length - 1])}
                      className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed border-slate-400 bg-white px-1.5 text-slate-700 transition-colors hover:border-teal-700 hover:bg-teal-50 hover:text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                      <span className="text-center text-[11px] font-semibold leading-tight">{next.label}</span>
                      {next.year && (
                        <span className="text-center text-[10px] font-medium leading-tight text-slate-500">{next.year}</span>
                      )}
                    </button>
                  );
                })()}
              </div>
            )}
          </div>

          {model.activeYears.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">Keine Jahrgänge mit Werkstattwahl in diesem Zeitraum.</p>
          ) : (
            <svg
              width={model.chartW}
              height={model.bodyH}
              viewBox={`0 0 ${model.chartW} ${model.bodyH}`}
              aria-label="Fluss der Jahrgänge durch die Trimester"
              className="relative z-[1] block"
              style={{ fontFamily: 'inherit' }}
            >
              {model.columns.map(column =>
                column.boxes.map(box => {
                  const boxX = colX(column.index) + (COL_W - BOX_W) / 2;
                  const planned = box.phase === 'planned';
                  const selected = selectedPlanKey === column.plan.key;
                  const bandSelected = selectedBand?.planKey === column.plan.key && selectedBand?.bandId === box.bandId;
                  return (
                    <rect
                      key={`fill-${column.plan.key}-${box.bandId}`}
                      x={boxX}
                      y={box.top}
                      width={BOX_W}
                      height={box.height}
                      rx={12}
                      fill={bandSelected ? '#ccfbf1' : planned ? '#fffbeb' : selected ? '#f0fdfa' : '#ffffff'}
                    />
                  );
                })
              )}
              {model.activeYears.map(year => {
                const color = jahrgangColor(year);
                const dim = Boolean(selection && selection.year !== year);
                return (
                  <g key={`lines-${year}`} opacity={dim ? 0.28 : 1}>
                    {model.nodes
                      .filter(node => node.year === year)
                      .map(node => (
                        <g key={`curves-${node.leftPlan.key}`}>
                          {model.columns
                            .find(column => column.plan.key === node.leftPlan.key)
                            ?.boxes.filter(box => box.lineY[year] != null)
                            .map(box => {
                              const leftIndex = model.columns.findIndex(column => column.plan.key === node.leftPlan.key);
                              const boxRight = colX(leftIndex) + (COL_W + BOX_W) / 2;
                              const frameRight = colX(leftIndex) + COL_W - 6;
                              const y = box.lineY[year];
                              const outgoing = taper(boxRight - 1, frameRight, y);
                              return (
                                <g key={`in-${box.bandId}`}>
                                  <path d={outgoing.path} fill={color} />
                                  {outgoing.xEnd < frameRight && (
                                    <line
                                      x1={outgoing.xEnd}
                                      y1={y}
                                      x2={frameRight}
                                      y2={y}
                                      stroke={color}
                                      strokeWidth={THIN}
                                      strokeLinecap="butt"
                                    />
                                  )}
                                  <path
                                    d={flowCurve(frameRight, y, node.x - NODE_W / 2 + 1, node.y)}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth={THIN}
                                    strokeLinecap="butt"
                                  />
                                </g>
                              );
                            })}
                          {model.columns
                            .find(column => column.plan.key === node.rightPlan.key)
                            ?.boxes.filter(box => box.lineY[year] != null)
                            .map(box => {
                              const rightIndex = model.columns.findIndex(column => column.plan.key === node.rightPlan.key);
                              const boxLeft = colX(rightIndex) + (COL_W - BOX_W) / 2;
                              const frameLeft = colX(rightIndex) + 6;
                              const y = box.lineY[year];
                              const incoming = taper(boxLeft + 1, frameLeft, y);
                              return (
                                <g key={`out-${box.bandId}`}>
                                  <path
                                    d={flowCurve(node.x + NODE_W / 2 - 1, node.y, frameLeft, y)}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth={THIN}
                                    strokeLinecap="butt"
                                  />
                                  {incoming.xEnd > frameLeft && (
                                    <line
                                      x1={frameLeft}
                                      y1={y}
                                      x2={incoming.xEnd}
                                      y2={y}
                                      stroke={color}
                                      strokeWidth={THIN}
                                      strokeLinecap="butt"
                                    />
                                  )}
                                  <path d={incoming.path} fill={color} />
                                </g>
                              );
                            })}
                        </g>
                      ))}

                    {model.columns.map((column, index) =>
                      column.boxes
                        .filter(box => box.lineY[year] != null)
                        .map(box => {
                          const boxX = colX(index) + (COL_W - BOX_W) / 2;
                          const y = box.lineY[year];
                          const joinsLeft = model.nodes.some(
                            node => node.year === year && node.rightPlan.key === column.plan.key
                          );
                          const joinsRight = model.nodes.some(
                            node => node.year === year && node.leftPlan.key === column.plan.key && node.right.length
                          );
                          return (
                            <line
                              key={`stroke-${column.plan.key}-${box.bandId}`}
                              x1={joinsLeft ? boxX : boxX + 12}
                              y1={y}
                              x2={joinsRight ? boxX + BOX_W : boxX + BOX_W - 12}
                              y2={y}
                              stroke={color}
                              strokeWidth={THICK}
                              strokeLinecap="butt"
                            />
                          );
                        })
                    )}
                  </g>
                );
              })}

              {model.columns.map(column =>
                column.boxes.map(box => {
                  const boxX = colX(column.index) + (COL_W - BOX_W) / 2;
                  const planned = box.phase === 'planned';
                  const selected = selectedPlanKey === column.plan.key;
                  const bandSelected = selectedBand?.planKey === column.plan.key && selectedBand?.bandId === box.bandId;
                  const border = bandSelected ? '#0f766e' : planned ? '#b45309' : selected ? '#115e59' : '#334155';
                  const openBand = () => onSelectBand?.(column.plan, box.bandId);
                  return (
                    <g
                      key={`box-${column.plan.key}-${box.bandId}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${bandTitle(column.plan, box.bandId)} bearbeiten`}
                      aria-pressed={bandSelected}
                      className="cursor-pointer outline-none"
                      onClick={event => {
                        event.stopPropagation();
                        openBand();
                      }}
                      onKeyDown={event => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        openBand();
                      }}
                    >
                      <title>
                        {bandTitle(column.plan, box.bandId)}
                        {planned ? ' — noch ohne hochgeladene Wahl' : ''}
                        . Kurse dieses Bands bearbeiten.
                      </title>
                      <rect
                        x={boxX}
                        y={box.top}
                        width={BOX_W}
                        height={box.height}
                        rx={12}
                        fill="transparent"
                        stroke={border}
                        strokeWidth={bandSelected ? 3.5 : 2.5}
                        strokeDasharray={planned && !bandSelected ? '6 3' : undefined}
                      />
                      <text
                        x={boxX + BOX_W / 2}
                        y={box.top + 16}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#0f172a"
                        fontSize={13}
                        fontWeight={700}
                      >
                        {bandIndex(box.bandId) + 1}
                      </text>
                      {planned && box.people.length === 0 && (
                        <text
                          x={boxX + BOX_W / 2}
                          y={box.top + box.height / 2 + 8}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#b45309"
                          fontSize={10}
                          fontWeight={600}
                        >
                          offen
                        </text>
                      )}
                    </g>
                  );
                })
              )}

              {model.nodes.map(node => {
                const color = jahrgangColor(node.year);
                const dim = Boolean(selection && selection.year !== node.year);
                const active =
                  selection?.year === node.year &&
                  selection?.completedPlan?.key === node.leftPlan.key &&
                  selection?.upcomingPlan?.key === node.rightPlan.key;
                const label = `Jahrgang ${node.year}: feste Kurswahlen ab T${node.rightPlan.trimester}`;
                return (
                  <g
                    key={`node-${node.year}-${node.leftPlan.key}`}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    aria-pressed={active}
                    opacity={dim ? 0.28 : 1}
                    className="cursor-pointer outline-none"
                    onClick={event => {
                      event.stopPropagation();
                      onSelectMerge({
                        year: node.year,
                        completedPlan: node.leftPlan,
                        upcomingPlan: node.rightPlan,
                      });
                    }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onSelectMerge({
                        year: node.year,
                        completedPlan: node.leftPlan,
                        upcomingPlan: node.rightPlan,
                      });
                    }}
                  >
                    <title>{label}</title>
                    <rect
                      x={node.x - NODE_W / 2 - 6}
                      y={node.y - NODE_H / 2 - 6}
                      width={NODE_W + 12}
                      height={NODE_H + 12}
                      fill="transparent"
                    />
                    <rect
                      x={node.x - NODE_W / 2}
                      y={node.y - NODE_H / 2}
                      width={NODE_W}
                      height={NODE_H}
                      rx={NODE_H / 2}
                      fill={active ? color : '#ffffff'}
                      stroke={color}
                      strokeWidth={active ? 0 : 3.5}
                    />
                    <text
                      x={node.x}
                      y={node.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={active ? '#ffffff' : color}
                      fontSize={10}
                      fontWeight={700}
                    >
                      {node.year}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
          {model.columns.map(column => {
            const { plan, index, mark, boxes } = column;
            const selected = selectedPlanKey === plan.key;
            const plannedOnly = mark === 'plan';
            const last = boxes[boxes.length - 1];
            const frameTop = FRAME_TOP;
            const frameBottom = last ? HEADER_H + last.top + last.height + 14 : HEADER_H - 8;
            return (
              <div
                key={`rim-${plan.key}`}
                aria-hidden
                className={`pointer-events-none absolute z-[2] rounded-xl border-2 ${
                  selected
                    ? 'border-teal-800'
                    : plannedOnly
                      ? 'border-dashed border-amber-700'
                      : 'border-slate-600'
                }`}
                style={{
                  left: colX(index) + 6,
                  width: COL_W - 12,
                  top: frameTop,
                  height: Math.max(50, frameBottom - frameTop),
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}


function PagerButton({ label, disabled, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
    >
      {children}
    </button>
  );
}

export default function StudentFlowView({
  plansChronological,
  students,
  studentClasses,
  studentEnrollmentYears,
  confirmedAssignments,
  loadChoicesForKey,
  rules,
  embedMode = false,
  selectedPlanKey = null,
  selectedBand = null,
  onSelectPlan,
  onSelectBand,
  onInsertTrimesterAfter,
  onMergeSelectionChange,
}) {
  const [selection, setSelection] = useState(null);
  const [freeReveal, setFreeReveal] = useState(0);
  const [yearPage, setYearPage] = useState(0);
  const [openStudent, setOpenStudent] = useState(null);

  const jahrgange = useMemo(() => {
    const years = new Set();
    students.forEach(s => {
      const y = studentEnrollmentYears[s];
      if (y != null) years.add(Number(y));
    });
    return [...years].sort((a, b) => b - a);
  }, [students, studentEnrollmentYears]);

  const schoolYearSpans = useMemo(() => {
    const spans = [];
    let i = 0;
    while (i < plansChronological.length) {
      const start = plansChronological[i].schoolYearStart;
      const end = plansChronological[i].schoolYearEnd;
      let j = i + 1;
      while (j < plansChronological.length && plansChronological[j].schoolYearStart === start) j += 1;
      spans.push({
        startCol: i,
        endCol: j - 1,
        label: `${start}/${end}`,
        colCount: j - i,
      });
      i = j;
    }
    return spans;
  }, [plansChronological]);

  useEffect(() => {
    if (embedMode) return;
    setYearPage(p => Math.min(p, Math.max(0, schoolYearSpans.length - 1)));
    setSelection(null);
  }, [schoolYearSpans.length, embedMode]);

  useEffect(() => {
    onMergeSelectionChange?.(!!selection);
  }, [selection, onMergeSelectionChange]);

  useEffect(() => {
    setOpenStudent(null);
  }, [selection, freeReveal]);

  const visiblePlans = useMemo(() => {
    if (embedMode) return plansChronological;
    const span = schoolYearSpans[yearPage];
    if (!span) return [];
    return plansChronological.slice(span.startCol, span.endCol + 1);
  }, [embedMode, plansChronological, schoolYearSpans, yearPage]);

  const cohortStudentsMap = useMemo(() => {
    const map = {};
    jahrgange.forEach(y => {
      map[y] = students.filter(s => Number(studentEnrollmentYears[s]) === y);
    });
    return map;
  }, [jahrgange, students, studentEnrollmentYears]);

  const nodeStats = useMemo(() => {
    const stats = {};
    jahrgange.forEach(year => {
      stats[year] = {};
      plansChronological.forEach(plan => {
        stats[year][plan.key] = getNodeStatusForJahrgang({
          enrollmentYear: year,
          plan,
          cohortStudents: cohortStudentsMap[year] || [],
          studentClasses,
          confirmedAssignments,
          loadChoicesForKey,
        });
      });
    });
    return stats;
  }, [jahrgange, plansChronological, cohortStudentsMap, studentClasses, confirmedAssignments, loadChoicesForKey]);

  const bandVisual = useCallback(
    (year, plan, bandId) => {
      const stat = nodeStats[year]?.[plan.key];
      const planBands = getPlanBandIds(plan);
      if (!stat?.active || !planBands.includes(bandId)) {
        return { visual: 'inactive', bs: null, flows: false };
      }
      const bs = stat.bandStats?.[bandId];
      const visual = getBandAggregateState(bs, true);
      return { visual, bs, flows: visual !== 'noAccess' && visual !== 'inactive' };
    },
    [nodeStats]
  );

  const handleSelectPlan = useCallback(
    plan => {
      onSelectPlan?.(plan);
      setSelection(null);
    },
    [onSelectPlan]
  );

  const handleSelectBand = useCallback(
    (plan, bandId) => {
      setSelection(null);
      onSelectBand?.(plan, bandId);
    },
    [onSelectBand]
  );

  const handleSelectMerge = useCallback(node => {
    setSelection(prev =>
      prev?.year === node.year &&
      prev?.completedPlan?.key === node.completedPlan.key &&
      prev?.upcomingPlan?.key === node.upcomingPlan.key
        ? null
        : {
            year: node.year,
            completedPlan: node.completedPlan,
            upcomingPlan: node.upcomingPlan,
          }
    );
    setFreeReveal(0);
  }, []);

  const detailStudents = useMemo(() => {
    if (!selection?.upcomingPlan) return [];
    return buildStudentFlowDetail({
      enrollmentYear: selection.year,
      plan: selection.upcomingPlan,
      plansChronological,
      students,
      studentEnrollmentYears,
      studentClasses,
      confirmedAssignments,
      rules,
    });
  }, [
    selection,
    students,
    studentEnrollmentYears,
    studentClasses,
    confirmedAssignments,
    rules,
    plansChronological,
  ]);

  const shownStudents = detailStudents.filter(row => row.outlook.freeChoices <= freeReveal);
  const nextFreeCount = detailStudents
    .map(row => row.outlook.freeChoices)
    .filter(count => count > freeReveal)
    .sort((a, b) => a - b)[0];

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border-2 border-slate-400 bg-white shadow-sm">
        {!embedMode && schoolYearSpans.length > 0 && (
          <div className="flex items-center justify-end gap-1.5 border-b border-slate-100 px-4 py-3">
            <PagerButton
              label="Vorheriges Schuljahr"
              disabled={yearPage <= 0}
              onClick={() => {
                setYearPage(p => p - 1);
                setSelection(null);
              }}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </PagerButton>
            <span className="min-w-[7.5rem] text-center text-sm font-semibold tabular-nums text-slate-800">
              {schoolYearSpans[yearPage]?.label ?? '—'}
            </span>
            <PagerButton
              label="Nächstes Schuljahr"
              disabled={yearPage >= schoolYearSpans.length - 1}
              onClick={() => {
                setYearPage(p => p + 1);
                setSelection(null);
              }}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </PagerButton>
          </div>
        )}

        {visiblePlans.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-slate-800">Noch keine Trimester</p>
            <p className="mt-1 text-xs text-slate-500">Lege ein Trimester an. Es erscheint dann hier im Zeitstrahl.</p>
          </div>
        ) : (
          <FlowBoard
            plans={visiblePlans}
            jahrgange={jahrgange}
            bandVisual={bandVisual}
            selection={selection}
            onSelectMerge={handleSelectMerge}
            selectedPlanKey={selectedPlanKey}
            selectedBand={selectedBand}
            onSelectPlan={onSelectPlan ? handleSelectPlan : undefined}
            onSelectBand={onSelectBand ? handleSelectBand : undefined}
            onInsertTrimesterAfter={onInsertTrimesterAfter}
            confirmedAssignments={confirmedAssignments}
            loadChoicesForKey={loadChoicesForKey}
          />
        )}
      </section>

      {selection && (
        <div className="space-y-4 rounded-2xl border-2 border-slate-400 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-base font-semibold text-slate-900">
                Jahrgang {selection.year}
                <span className="mx-1.5 font-normal text-slate-300">·</span>
                ab T{selection.upcomingPlan.trimester}
              </h4>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Je Schüler die Frist, die Kurse bis dahin und die freien Wahlen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            >
              Schließen
            </button>
          </div>

          {shownStudents.length === 0 ? (
            <p className="rounded-xl border-2 border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500">
              {nextFreeCount == null
                ? 'Ab hier kann dieser Jahrgang noch frei wählen.'
                : 'Niemand muss ab hier jede weitere Wahl festlegen.'}
            </p>
          ) : (
            <div className="max-h-[28rem] space-y-4 overflow-y-auto">
              {Array.from({ length: freeReveal + 1 }, (_, count) => {
                const members = detailStudents.filter(row => row.outlook.freeChoices === count);
                if (!members.length) return null;
                return (
                  <section key={count} aria-label={freeGroupTitle(count)}>
                    <h5 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <span>{freeGroupTitle(count)}</span>
                      <span className="tabular-nums">{members.length}</span>
                    </h5>
                    <div className="space-y-2">
                      {members.map(row => {
                        const open = openStudent === row.student;
                        const courseReasons = row.outlook.courseReasons || [];
                        const pickReasons = row.outlook.pickReasons || [];
                        return (
                          <article key={row.student} className="rounded-xl border-2 border-slate-300 bg-white">
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={() => setOpenStudent(open ? null : row.student)}
                              className="w-full px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-900">{row.student}</p>
                                <span className="flex items-center gap-2">
                                  {row.className ? (
                                    <span className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                                      {row.className}
                                    </span>
                                  ) : null}
                                  <span className="text-[11px] font-medium text-teal-800">{open ? 'Schließen' : 'Begründung'}</span>
                                </span>
                              </div>
                              <dl className="mt-2.5 grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-y-2 text-xs">
                                <dt className="pt-0.5 text-slate-400">Frist</dt>
                                <dd className="font-medium text-slate-800">Bis Stufe {row.outlook.deadlineStufe}</dd>
                                <dt className="pt-1 text-slate-400">Fest wählen</dt>
                                <dd className="space-y-2">
                                  {(row.outlook.mustAll || row.outlook.courses || []).length > 0 && (
                                    <div>
                                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                                        {(row.outlook.mustAll || row.outlook.courses).length === 1
                                          ? 'Diesen Kurs'
                                          : 'Jeden dieser Kurse'}
                                      </p>
                                      <div className="flex flex-wrap items-center gap-1">
                                        {(row.outlook.mustAll || row.outlook.courses).map((course, index) => (
                                          <React.Fragment key={course}>
                                            {index > 0 && <span className="text-[11px] text-slate-400">und</span>}
                                            <span className="rounded-md bg-white px-2 py-0.5 font-medium text-slate-800 ring-1 ring-slate-200">
                                              {course}
                                            </span>
                                          </React.Fragment>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {(row.outlook.choices || []).map(choice => (
                                    <RequirementBox
                                      key={`${choice.mode || 'pick'}-${choice.count}-${choice.options.join('|')}`}
                                      tone={choice.mode === 'or' ? 'or' : 'pick'}
                                      title={choice.mode === 'or' ? 'Eines von diesen' : `${choice.count} von diesen`}
                                      conjunction={choice.mode === 'or' ? 'oder' : null}
                                      options={choice.options}
                                    />
                                  ))}
                                </dd>
                                <dt className="pt-0.5 text-slate-400">Frei bis dahin</dt>
                                <dd className="flex items-center gap-1.5 font-semibold text-slate-900">
                                  <span>{freedomCopy(row.outlook.free, row.outlook.slots)}</span>
                                  {row.outlook.assumptionNote ? (
                                    <span
                                      title={row.outlook.assumptionNote}
                                      aria-label={row.outlook.assumptionNote}
                                      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600"
                                    >
                                      i
                                    </span>
                                  ) : null}
                                </dd>
                              </dl>
                            </button>
                            {open && (
                              <div className="space-y-3 border-t border-slate-200 px-3 py-3 text-xs leading-5 text-slate-700">
                                {(courseReasons.length > 0 || pickReasons.length > 0) && (
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Feste Kurse</p>
                                    <ul className="mt-1.5 space-y-2">
                                      {courseReasons.map(reason => (
                                        <li key={`${reason.course}-${reason.ruleName}-${reason.text}`}>
                                          <span className="font-medium text-slate-900">{reason.course}</span>
                                          <span className="text-slate-500"> · Regel „{reason.ruleName}“</span>
                                          <p>{reason.text}</p>
                                        </li>
                                      ))}
                                      {pickReasons.map(reason => (
                                        <li key={`${reason.ruleName}-${reason.label}`}>
                                          {reason.mode === 'or' || reason.mode === 'pick' ? (
                                            <RequirementBox
                                              tone={reason.mode === 'or' ? 'or' : 'pick'}
                                              title={reason.mode === 'or' ? 'Eines von diesen' : `${reason.count} von diesen`}
                                              conjunction={reason.mode === 'or' ? 'oder' : null}
                                              options={reason.options || []}
                                            />
                                          ) : (
                                            <span className="font-medium text-slate-900">{reason.label}</span>
                                          )}
                                          <span className="text-slate-500"> · Regel „{reason.ruleName}“</span>
                                          <p>{reason.text}</p>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {row.outlook.freeExplanation && (
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Freie Wahlen</p>
                                    <p className="mt-1.5">{row.outlook.freeExplanation}</p>
                                    {row.outlook.assumptionNote ? (
                                      <p className="mt-1.5 text-slate-500">{row.outlook.assumptionNote}</p>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {nextFreeCount != null && (
            <button
              type="button"
              onClick={() => setFreeReveal(nextFreeCount)}
              className="w-full rounded-xl border-2 border-dashed border-slate-400 px-3 py-2.5 text-sm font-medium text-teal-800 hover:border-teal-700 hover:bg-teal-50"
            >
              Auch Schüler mit noch {nextFreeCount} {nextFreeCount === 1 ? 'freier Wahl' : 'freien Wahlen'} anzeigen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
