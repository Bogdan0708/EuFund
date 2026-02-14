'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { GanttData, TimelineItem } from '@/types/timeline';

interface GanttChartProps {
  data: GanttData;
  onTaskUpdate?: (taskId: string, updates: { startDate: string; endDate: string }) => void;
  onTaskClick?: (task: TimelineItem) => void;
  locale?: string;
}

type ViewMode = 'months' | 'weeks' | 'days';

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-blue-200 border-blue-400',
  active: 'bg-green-200 border-green-400',
  completed: 'bg-gray-300 border-gray-500',
  delayed: 'bg-red-200 border-red-400',
  cancelled: 'bg-gray-100 border-gray-300',
};

const RISK_COLORS: Record<string, string> = {
  very_low: 'bg-emerald-500',
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  very_high: 'bg-red-500',
};

function daysBetween(a: string, b: string): number {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatDate(date: string, locale: string = 'ro-RO'): string {
  return new Date(date).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function generateTimeHeaders(start: string, end: string, mode: ViewMode) {
  const headers: { label: string; date: string; width: number }[] = [];
  const s = new Date(start);
  const e = new Date(end);

  if (mode === 'months') {
    const current = new Date(s.getFullYear(), s.getMonth(), 1);
    while (current <= e) {
      const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
      headers.push({
        label: current.toLocaleDateString('ro-RO', { month: 'short', year: '2-digit' }),
        date: current.toISOString().split('T')[0],
        width: daysInMonth,
      });
      current.setMonth(current.getMonth() + 1);
    }
  } else if (mode === 'weeks') {
    const current = new Date(s);
    current.setDate(current.getDate() - current.getDay() + 1);
    while (current <= e) {
      headers.push({
        label: `S${Math.ceil((current.getTime() - new Date(current.getFullYear(), 0, 1).getTime()) / 604800000)}`,
        date: current.toISOString().split('T')[0],
        width: 7,
      });
      current.setDate(current.getDate() + 7);
    }
  } else {
    const current = new Date(s);
    while (current <= e) {
      headers.push({
        label: current.getDate().toString(),
        date: current.toISOString().split('T')[0],
        width: 1,
      });
      current.setDate(current.getDate() + 1);
    }
  }
  return headers;
}

export function GanttChart({ data, onTaskUpdate, onTaskClick, locale = 'ro' }: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('months');
  const [dragState, setDragState] = useState<{
    taskId: string;
    type: 'move' | 'resize-end';
    startX: number;
    originalStart: string;
    originalEnd: string;
  } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [hoveredTask, setHoveredTask] = useState<string | null>(null);

  const { projectStartDate, projectEndDate } = data;
  if (!projectStartDate || !projectEndDate) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Nu există date de timeline pentru acest proiect. Adăugați pachete de lucru cu date.
        </CardContent>
      </Card>
    );
  }

  const paddedStart = addDays(projectStartDate, -7);
  const paddedEnd = addDays(projectEndDate, 14);
  const totalDays = daysBetween(paddedStart, paddedEnd);
  const dayWidth = viewMode === 'days' ? 30 : viewMode === 'weeks' ? 8 : 3;
  const chartWidth = totalDays * dayWidth;

  const headers = useMemo(
    () => generateTimeHeaders(paddedStart, paddedEnd, viewMode),
    [paddedStart, paddedEnd, viewMode]
  );

  const todayOffset = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const offset = daysBetween(paddedStart, today);
    return offset >= 0 && offset <= totalDays ? offset * dayWidth : -1;
  }, [paddedStart, totalDays, dayWidth]);

  // Build dependency map for drawing lines
  const allTasks = useMemo(() => {
    const tasks: (TimelineItem & { wpName: string; rowIndex: number })[] = [];
    let row = 0;
    data.workPackages.forEach(wp => {
      row++; // WP header row
      wp.tasks.forEach(t => {
        tasks.push({ ...t, wpName: wp.name, rowIndex: row });
        row++;
      });
    });
    return tasks;
  }, [data]);

  const taskPositions = useMemo(() => {
    const map = new Map<string, { left: number; width: number; top: number }>();
    allTasks.forEach(t => {
      const left = daysBetween(paddedStart, t.startDate) * dayWidth;
      const width = Math.max(daysBetween(t.startDate, t.endDate) * dayWidth, dayWidth);
      map.set(t.id, { left, width, top: t.rowIndex * 44 + 22 });
    });
    return map;
  }, [allTasks, paddedStart, dayWidth]);

  // Critical path: tasks with high/very_high risk
  const criticalTasks = useMemo(
    () => new Set(allTasks.filter(t => t.riskLevel === 'high' || t.riskLevel === 'very_high').map(t => t.id)),
    [allTasks]
  );

  const handleMouseDown = useCallback((
    e: React.MouseEvent,
    taskId: string,
    type: 'move' | 'resize-end',
    startDate: string,
    endDate: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ taskId, type, startX: e.clientX, originalStart: startDate, originalEnd: endDate });
  }, []);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState || !onTaskUpdate) return;
      const dx = e.clientX - dragState.startX;
      const daysDelta = Math.round(dx / dayWidth);
      if (daysDelta === 0) return;

      if (dragState.type === 'move') {
        onTaskUpdate(dragState.taskId, {
          startDate: addDays(dragState.originalStart, daysDelta),
          endDate: addDays(dragState.originalEnd, daysDelta),
        });
      } else {
        const newEnd = addDays(dragState.originalEnd, daysDelta);
        if (newEnd > dragState.originalStart) {
          onTaskUpdate(dragState.taskId, {
            startDate: dragState.originalStart,
            endDate: newEnd,
          });
        }
      }
    };

    const handleMouseUp = () => setDragState(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, dayWidth, onTaskUpdate]);

  let rowIndex = 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">📊 Diagrama Gantt</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Progres total: {data.totalProgress}%</span>
          <div className="flex rounded-md border">
            {(['months', 'weeks', 'days'] as ViewMode[]).map(mode => (
              <Button
                key={mode}
                variant={viewMode === mode ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none first:rounded-l-md last:rounded-r-md"
                onClick={() => setViewMode(mode)}
              >
                {mode === 'months' ? 'Luni' : mode === 'weeks' ? 'Săpt.' : 'Zile'}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex overflow-x-auto" ref={chartRef}>
          {/* Left panel: task names */}
          <div className="min-w-[240px] border-r bg-muted/30 flex-shrink-0">
            <div className="h-10 border-b px-3 flex items-center font-medium text-sm">
              Pachete de lucru / Activități
            </div>
            {data.workPackages.map(wp => (
              <div key={wp.id}>
                <div className="h-11 border-b px-3 flex items-center gap-2 bg-muted/50 font-medium text-sm">
                  <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[wp.status]?.split(' ')[0] || 'bg-gray-400'}`} />
                  <span className="truncate">{wp.name}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {wp.status === 'planned' ? 'Planificat' :
                     wp.status === 'active' ? 'Activ' :
                     wp.status === 'completed' ? 'Finalizat' :
                     wp.status === 'delayed' ? 'Întârziat' : wp.status}
                  </Badge>
                </div>
                {wp.tasks.map(task => (
                  <div
                    key={task.id}
                    className="h-11 border-b px-3 pl-6 flex items-center text-sm cursor-pointer hover:bg-muted/20"
                    onClick={() => onTaskClick?.(task)}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mr-2 ${RISK_COLORS[task.riskLevel]}`} />
                    <span className="truncate">{task.taskName}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{task.progressPercentage}%</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Right panel: chart area */}
          <div className="flex-1 overflow-x-auto">
            <div style={{ width: chartWidth, minWidth: '100%' }}>
              {/* Time header */}
              <div className="h-10 border-b flex">
                {headers.map((h, i) => (
                  <div
                    key={i}
                    className="border-r text-[10px] text-center text-muted-foreground flex items-center justify-center"
                    style={{ width: h.width * dayWidth }}
                  >
                    {h.label}
                  </div>
                ))}
              </div>

              {/* Chart rows */}
              <div className="relative">
                {/* Today marker */}
                {todayOffset >= 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
                    style={{ left: todayOffset }}
                  >
                    <div className="absolute -top-0 -left-2 text-[8px] bg-red-500 text-white px-1 rounded-b">
                      Azi
                    </div>
                  </div>
                )}

                {/* Dependency lines (SVG overlay) */}
                <svg
                  className="absolute inset-0 pointer-events-none z-10"
                  style={{ width: chartWidth, height: (allTasks.length + data.workPackages.length) * 44 }}
                >
                  {allTasks.map(task =>
                    task.dependencies.map(depId => {
                      const from = taskPositions.get(depId);
                      const to = taskPositions.get(task.id);
                      if (!from || !to) return null;
                      const isCritical = criticalTasks.has(task.id) && criticalTasks.has(depId);
                      return (
                        <g key={`${depId}-${task.id}`}>
                          <path
                            d={`M ${from.left + from.width} ${from.top} 
                                C ${from.left + from.width + 20} ${from.top}, 
                                  ${to.left - 20} ${to.top}, 
                                  ${to.left} ${to.top}`}
                            fill="none"
                            stroke={isCritical ? '#ef4444' : '#94a3b8'}
                            strokeWidth={isCritical ? 2 : 1}
                            strokeDasharray={isCritical ? '' : '4 2'}
                            markerEnd="url(#arrowhead)"
                          />
                        </g>
                      );
                    })
                  )}
                  <defs>
                    <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
                    </marker>
                  </defs>
                </svg>

                {data.workPackages.map(wp => {
                  rowIndex++;
                  const wpLeft = daysBetween(paddedStart, wp.startDate || paddedStart) * dayWidth;
                  const wpWidth = Math.max(
                    daysBetween(wp.startDate || paddedStart, wp.endDate || paddedEnd) * dayWidth,
                    dayWidth * 2
                  );

                  return (
                    <div key={wp.id}>
                      {/* WP summary bar */}
                      <div className="h-11 border-b relative">
                        <div
                          className={`absolute top-2 h-7 rounded ${STATUS_COLORS[wp.status]} border opacity-60`}
                          style={{ left: wpLeft, width: wpWidth }}
                        />
                      </div>
                      {/* Task bars */}
                      {wp.tasks.map(task => {
                        rowIndex++;
                        const left = daysBetween(paddedStart, task.startDate) * dayWidth;
                        const width = Math.max(daysBetween(task.startDate, task.endDate) * dayWidth, dayWidth);
                        const progressWidth = (width * task.progressPercentage) / 100;
                        const isHovered = hoveredTask === task.id;
                        const isCritical = criticalTasks.has(task.id);

                        return (
                          <div key={task.id} className="h-11 border-b relative group">
                            {/* Task bar */}
                            <div
                              className={`absolute top-2 h-7 rounded border cursor-grab active:cursor-grabbing transition-shadow
                                ${isCritical ? 'border-red-500 ring-1 ring-red-200' : 'border-primary/30'}
                                ${isHovered ? 'shadow-md ring-2 ring-primary/20' : ''}
                                bg-primary/10`}
                              style={{ left, width }}
                              onMouseDown={e => handleMouseDown(e, task.id, 'move', task.startDate, task.endDate)}
                              onMouseEnter={() => setHoveredTask(task.id)}
                              onMouseLeave={() => setHoveredTask(null)}
                              onClick={() => onTaskClick?.(task)}
                            >
                              {/* Progress fill */}
                              <div
                                className={`h-full rounded-l ${RISK_COLORS[task.riskLevel]} opacity-30`}
                                style={{ width: progressWidth }}
                              />
                              {/* Progress text */}
                              {width > 40 && (
                                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium">
                                  {task.progressPercentage}%
                                </span>
                              )}
                              {/* Resize handle */}
                              {onTaskUpdate && (
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 rounded-r"
                                  onMouseDown={e => handleMouseDown(e, task.id, 'resize-end', task.startDate, task.endDate)}
                                />
                              )}
                            </div>

                            {/* Tooltip on hover */}
                            {isHovered && (
                              <div className="absolute z-30 bg-popover border rounded-md shadow-lg p-2 text-xs"
                                style={{ left: left + width + 8, top: 0 }}>
                                <p className="font-medium">{task.taskName}</p>
                                <p className="text-muted-foreground">
                                  {formatDate(task.startDate)} → {formatDate(task.endDate)}
                                </p>
                                <p>Progres: {task.progressPercentage}%</p>
                                <p>Risc: {task.riskLevel}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="border-t px-4 py-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Risc f. scăzut</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Risc scăzut</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Risc mediu</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Risc ridicat</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Risc f. ridicat</span>
          <span className="flex items-center gap-1"><span className="w-0.5 h-3 bg-red-500" /> Astăzi</span>
          <span className="flex items-center gap-1">--- Dependențe</span>
        </div>
      </CardContent>
    </Card>
  );
}
