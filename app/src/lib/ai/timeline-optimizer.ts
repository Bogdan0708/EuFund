// ─── Timeline Optimization Algorithms ────────────────────────────
// Critical path analysis, resource leveling, bottleneck detection,
// what-if scenario planning, and Romanian holiday-aware scheduling.


// ─── Types ───────────────────────────────────────────────────────

export interface OptimizedTask {
  id: string;
  name: string;
  originalStart: string;
  originalEnd: string;
  optimizedStart: string;
  optimizedEnd: string;
  duration: number; // days
  slack: number; // float days
  isCritical: boolean;
  dependencies: string[];
  assignedResources: string[];
  bufferDays: number;
  reason?: string;
}

export interface Bottleneck {
  taskId: string;
  taskName: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact: string;
  dependentTasks: number;
  delayRiskDays: number;
  mitigationOptions: string[];
}

export interface OptimizationRecommendation {
  type: 'reschedule' | 'add-buffer' | 'reallocate-resource' | 'split-task' | 'parallel-execution' | 'add-milestone';
  priority: 'low' | 'medium' | 'high';
  description: string;
  descriptionRo: string;
  affectedTasks: string[];
  expectedImprovementDays: number;
}

export interface ResourceConflict {
  resourceId: string;
  resourceName: string;
  conflictingTasks: { taskId: string; taskName: string; start: string; end: string }[];
  overloadPercentage: number;
  resolution: string;
}

export interface TimelineOptimization {
  optimizedSchedule: OptimizedTask[];
  criticalPath: string[];
  bottlenecks: Bottleneck[];
  recommendations: OptimizationRecommendation[];
  resourceConflicts: ResourceConflict[];
  feasibilityScore: number; // 0-100
  totalDuration: number;
  bufferUtilization: number;
  projectEndDate: string;
}

export interface TimelineTask {
  id: string;
  name: string;
  start: string; // ISO date
  end: string;
  dependencies: string[];
  assignedResources: string[];
  workPackageId?: string;
  percentComplete?: number;
  isMilestone?: boolean;
}

export interface ResourceAvailability {
  resourceId: string;
  name: string;
  role: string;
  availability: number; // 0-1 fraction
  vacationDays?: string[]; // ISO dates
  maxConcurrentTasks?: number;
}

export interface TimelineOptimizationInput {
  projectId: string;
  tasks: TimelineTask[];
  resources: ResourceAvailability[];
  projectStart: string;
  projectEnd: string;
  includeRomanianHolidays?: boolean;
  bureaucracyBufferPercent?: number; // default 15%
  locale?: 'ro' | 'en';
}

export interface WhatIfScenario {
  name: string;
  changes: ScenarioChange[];
}

export interface ScenarioChange {
  type: 'delay-task' | 'remove-task' | 'add-task' | 'change-resource' | 'change-duration';
  taskId?: string;
  delayDays?: number;
  newDuration?: number;
  newResource?: string;
  newTask?: TimelineTask;
}

export interface ScenarioResult {
  scenarioName: string;
  feasible: boolean;
  newEndDate: string;
  delayDays: number;
  affectedTasks: string[];
  newCriticalPath: string[];
  feasibilityScore: number;
  summary: string;
  summaryRo: string;
}

// ─── Romanian Holiday Calendar ───────────────────────────────────

const ROMANIAN_HOLIDAYS: Record<string, { name: string; nameRo: string }> = {
  '01-01': { name: "New Year's Day", nameRo: 'Anul Nou' },
  '01-02': { name: "Day after New Year's", nameRo: 'A doua zi de Anul Nou' },
  '01-24': { name: 'Unification Day', nameRo: 'Ziua Unirii Principatelor Române' },
  '05-01': { name: 'Labour Day', nameRo: 'Ziua Muncii' },
  '06-01': { name: "Children's Day", nameRo: 'Ziua Copilului' },
  '08-15': { name: 'Assumption of Mary', nameRo: 'Adormirea Maicii Domnului' },
  '11-30': { name: "St. Andrew's Day", nameRo: 'Sfântul Andrei' },
  '12-01': { name: 'National Day of Romania', nameRo: 'Ziua Națională a României' },
  '12-25': { name: 'Christmas Day', nameRo: 'Crăciun' },
  '12-26': { name: 'Second Day of Christmas', nameRo: 'A doua zi de Crăciun' },
};

// Orthodox Easter dates (precomputed for relevant years)
const ORTHODOX_EASTER: Record<number, string> = {
  2024: '2024-05-05',
  2025: '2025-04-20',
  2026: '2026-04-12',
  2027: '2027-05-02',
  2028: '2028-04-16',
  2029: '2029-04-08',
  2030: '2030-04-28',
};

function getOrthodoxEasterDates(year: number): string[] {
  const easter = ORTHODOX_EASTER[year];
  if (!easter) return [];
  const easterDate = new Date(easter);
  const goodFriday = new Date(easterDate);
  goodFriday.setDate(goodFriday.getDate() - 2);
  const easterMonday = new Date(easterDate);
  easterMonday.setDate(easterMonday.getDate() + 1);
  // Pentecost is 49 days after Easter
  const pentecost = new Date(easterDate);
  pentecost.setDate(pentecost.getDate() + 49);
  const pentecostMonday = new Date(pentecost);
  pentecostMonday.setDate(pentecostMonday.getDate() + 1);
  return [
    goodFriday.toISOString().slice(0, 10),
    easter,
    easterMonday.toISOString().slice(0, 10),
    pentecost.toISOString().slice(0, 10),
    pentecostMonday.toISOString().slice(0, 10),
  ];
}

export function getRomanianHolidays(year: number): { date: string; name: string; nameRo: string }[] {
  const holidays: { date: string; name: string; nameRo: string }[] = [];

  for (const [mmdd, info] of Object.entries(ROMANIAN_HOLIDAYS)) {
    holidays.push({ date: `${year}-${mmdd}`, ...info });
  }

  const easterDates = getOrthodoxEasterDates(year);
  const easterNames = [
    { name: 'Orthodox Good Friday', nameRo: 'Vinerea Mare' },
    { name: 'Orthodox Easter', nameRo: 'Paștele Ortodox' },
    { name: 'Orthodox Easter Monday', nameRo: 'A doua zi de Paște' },
    { name: 'Pentecost', nameRo: 'Rusalii' },
    { name: 'Pentecost Monday', nameRo: 'A doua zi de Rusalii' },
  ];
  easterDates.forEach((d, i) => holidays.push({ date: d, ...easterNames[i] }));

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

function isHolidayOrWeekend(date: Date, holidaySet: Set<string>): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return true;
  return holidaySet.has(date.toISOString().slice(0, 10));
}

function addBusinessDays(start: Date, days: number, holidaySet: Set<string>): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (!isHolidayOrWeekend(result, holidaySet)) added++;
  }
  return result;
}

function businessDaysBetween(start: Date, end: Date, holidaySet: Set<string>): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    current.setDate(current.getDate() + 1);
    if (!isHolidayOrWeekend(current, holidaySet)) count++;
  }
  return count;
}

// ─── Critical Path Analysis (CPM) ───────────────────────────────

interface CpmNode {
  id: string;
  duration: number;
  dependencies: string[];
  es: number; // earliest start
  ef: number; // earliest finish
  ls: number; // latest start
  lf: number; // latest finish
  slack: number;
}

function computeCriticalPath(tasks: TimelineTask[], holidaySet: Set<string>): {
  nodes: Map<string, CpmNode>;
  criticalPath: string[];
  totalDuration: number;
} {
  const nodes = new Map<string, CpmNode>();

  // Build nodes with business-day durations
  for (const task of tasks) {
    const start = new Date(task.start);
    const end = new Date(task.end);
    const duration = businessDaysBetween(start, end, holidaySet) || 1;
    nodes.set(task.id, {
      id: task.id,
      duration,
      dependencies: task.dependencies,
      es: 0, ef: 0, ls: 0, lf: 0, slack: 0,
    });
  }

  // Topological sort
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // cycle detection - skip
    visiting.add(id);
    const node = nodes.get(id);
    if (node) {
      for (const dep of node.dependencies) {
        if (nodes.has(dep)) visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const id of nodes.keys()) visit(id);

  // Forward pass: compute ES, EF
  for (const id of sorted) {
    const node = nodes.get(id)!;
    let maxEf = 0;
    for (const dep of node.dependencies) {
      const depNode = nodes.get(dep);
      if (depNode) maxEf = Math.max(maxEf, depNode.ef);
    }
    node.es = maxEf;
    node.ef = node.es + node.duration;
  }

  // Find project duration
  let totalDuration = 0;
  for (const node of nodes.values()) {
    totalDuration = Math.max(totalDuration, node.ef);
  }

  // Backward pass: compute LS, LF, slack
  for (const node of nodes.values()) {
    node.lf = totalDuration;
    node.ls = totalDuration;
  }

  for (let i = sorted.length - 1; i >= 0; i--) {
    const node = nodes.get(sorted[i])!;
    // Find all tasks that depend on this one
    let minLs = totalDuration;
    for (const other of nodes.values()) {
      if (other.dependencies.includes(node.id)) {
        minLs = Math.min(minLs, other.ls);
      }
    }
    node.lf = minLs;
    node.ls = node.lf - node.duration;
    node.slack = node.ls - node.es;
  }

  // Extract critical path (slack = 0)
  const criticalPath = sorted.filter(id => {
    const node = nodes.get(id)!;
    return Math.abs(node.slack) < 0.001;
  });

  return { nodes, criticalPath, totalDuration };
}

// ─── Resource Leveling ───────────────────────────────────────────

function detectResourceConflicts(
  tasks: TimelineTask[],
  resources: ResourceAvailability[]
): ResourceConflict[] {
  const conflicts: ResourceConflict[] = [];
  const resourceMap = new Map(resources.map(r => [r.resourceId, r]));

  // Group tasks by resource
  const tasksByResource = new Map<string, TimelineTask[]>();
  for (const task of tasks) {
    for (const resId of task.assignedResources) {
      if (!tasksByResource.has(resId)) tasksByResource.set(resId, []);
      tasksByResource.get(resId)!.push(task);
    }
  }

  for (const [resId, resTasks] of tasksByResource) {
    const resource = resourceMap.get(resId);
    const maxConcurrent = resource?.maxConcurrentTasks ?? 2;

    // Check for overlapping tasks
    const overlaps: TimelineTask[][] = [];
    for (let i = 0; i < resTasks.length; i++) {
      for (let j = i + 1; j < resTasks.length; j++) {
        const a = resTasks[i];
        const b = resTasks[j];
        if (a.start <= b.end && b.start <= a.end) {
          overlaps.push([a, b]);
        }
      }
    }

    // Count max concurrent at any point
    if (overlaps.length > 0) {
      // Find peak concurrency
      const events: { date: string; delta: number }[] = [];
      for (const t of resTasks) {
        events.push({ date: t.start, delta: 1 });
        events.push({ date: t.end, delta: -1 });
      }
      events.sort((a, b) => a.date.localeCompare(b.date) || a.delta - b.delta);

      let current = 0;
      let peak = 0;
      for (const e of events) {
        current += e.delta;
        peak = Math.max(peak, current);
      }

      if (peak > maxConcurrent) {
        const conflictingTasks = resTasks
          .sort((a, b) => a.start.localeCompare(b.start))
          .map(t => ({ taskId: t.id, taskName: t.name, start: t.start, end: t.end }));

        conflicts.push({
          resourceId: resId,
          resourceName: resource?.name ?? resId,
          conflictingTasks,
          overloadPercentage: Math.round(((peak - maxConcurrent) / maxConcurrent) * 100),
          resolution: `Reduce concurrent assignments from ${peak} to ${maxConcurrent}, or extend task timelines.`,
        });
      }
    }
  }

  return conflicts;
}

// ─── Bottleneck Detection ────────────────────────────────────────

function detectBottlenecks(
  tasks: TimelineTask[],
  cpmNodes: Map<string, CpmNode>
): Bottleneck[] {
  const bottlenecks: Bottleneck[] = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  for (const [id, node] of cpmNodes) {
    const task = taskMap.get(id);
    if (!task) continue;

    // Count how many tasks depend on this one (directly or transitively)
    const dependents = new Set<string>();
    function findDependents(taskId: string) {
      for (const t of tasks) {
        if (t.dependencies.includes(taskId) && !dependents.has(t.id)) {
          dependents.add(t.id);
          findDependents(t.id);
        }
      }
    }
    findDependents(id);

    const severity: Bottleneck['severity'] =
      dependents.size >= 5 && node.slack < 1 ? 'critical' :
      dependents.size >= 3 && node.slack < 3 ? 'high' :
      dependents.size >= 2 ? 'medium' : 'low';

    if (dependents.size >= 2 || node.slack < 2) {
      bottlenecks.push({
        taskId: id,
        taskName: task.name,
        severity,
        impact: `Blocks ${dependents.size} downstream tasks. Slack: ${node.slack.toFixed(1)} days.`,
        dependentTasks: dependents.size,
        delayRiskDays: Math.max(0, node.duration * 0.3),
        mitigationOptions: [
          dependents.size > 3 ? 'Consider splitting this task into parallel subtasks' : '',
          node.slack < 1 ? 'Add buffer time before this task' : '',
          task.assignedResources.length === 1 ? 'Assign additional resources to reduce risk' : '',
          'Identify early completion indicators for proactive monitoring',
        ].filter(Boolean),
      });
    }
  }

  return bottlenecks
    .sort((a, b) => {
      const sev = { critical: 0, high: 1, medium: 2, low: 3 };
      return sev[a.severity] - sev[b.severity];
    })
    .slice(0, 15);
}

// ─── Buffer Time Calculation ─────────────────────────────────────

const BUREAUCRACY_BUFFER_MAP: Record<string, number> = {
  'public-procurement': 30,  // SICAP/public procurement in Romania
  'anaf-registration': 15,   // ANAF tax registration
  'audit': 20,               // EU audit preparation
  'reporting': 10,           // EC reporting submission
  'partner-agreement': 20,   // Multi-partner contract negotiation
  'ethics-review': 15,       // Ethics committee review
  'default': 5,              // General buffer
};

function calculateBufferDays(task: TimelineTask, bufferPercent: number): number {
  const taskName = task.name.toLowerCase();
  let bufferDays = 0;

  for (const [key, days] of Object.entries(BUREAUCRACY_BUFFER_MAP)) {
    if (taskName.includes(key.replace(/-/g, ' ')) || taskName.includes(key)) {
      bufferDays = Math.max(bufferDays, days);
    }
  }

  if (bufferDays === 0) {
    const start = new Date(task.start);
    const end = new Date(task.end);
    const duration = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    bufferDays = Math.ceil(duration * bufferPercent / 100);
  }

  return bufferDays;
}

// ─── Main Optimization ──────────────────────────────────────────

export async function optimizeTimeline(input: TimelineOptimizationInput): Promise<TimelineOptimization> {
  const bufferPercent = input.bureaucracyBufferPercent ?? 15;

  // Build holiday set
  const holidaySet = new Set<string>();
  if (input.includeRomanianHolidays !== false) {
    const startYear = new Date(input.projectStart).getFullYear();
    const endYear = new Date(input.projectEnd).getFullYear();
    for (let y = startYear; y <= endYear; y++) {
      for (const h of getRomanianHolidays(y)) {
        holidaySet.add(h.date);
      }
    }
  }

  // Add resource vacation days
  for (const res of input.resources) {
    for (const vd of res.vacationDays ?? []) {
      holidaySet.add(vd);
    }
  }

  // Critical path analysis
  const { nodes: cpmNodes, criticalPath, totalDuration } = computeCriticalPath(input.tasks, holidaySet);

  // Detect bottlenecks
  const bottlenecks = detectBottlenecks(input.tasks, cpmNodes);

  // Detect resource conflicts
  const resourceConflicts = detectResourceConflicts(input.tasks, input.resources);

  // Build optimized schedule
  const optimizedSchedule: OptimizedTask[] = input.tasks.map(task => {
    const cpmNode = cpmNodes.get(task.id);
    const bufferDays = calculateBufferDays(task, bufferPercent);
    const isCritical = criticalPath.includes(task.id);

    // Calculate optimized dates based on CPM
    const projectStartDate = new Date(input.projectStart);
    const optimizedStart = addBusinessDays(projectStartDate, cpmNode?.es ?? 0, holidaySet);
    const optimizedEnd = addBusinessDays(optimizedStart, cpmNode?.duration ?? 1, holidaySet);

    return {
      id: task.id,
      name: task.name,
      originalStart: task.start,
      originalEnd: task.end,
      optimizedStart: optimizedStart.toISOString().slice(0, 10),
      optimizedEnd: optimizedEnd.toISOString().slice(0, 10),
      duration: cpmNode?.duration ?? 1,
      slack: cpmNode?.slack ?? 0,
      isCritical,
      dependencies: task.dependencies,
      assignedResources: task.assignedResources,
      bufferDays,
      reason: isCritical ? 'Critical path task - no slack available' :
              (cpmNode?.slack ?? 0) < 3 ? 'Near-critical path - limited slack' : undefined,
    };
  });

  // Generate recommendations
  const recommendations: OptimizationRecommendation[] = [];

  // Recommend parallelization for long sequential chains
  if (criticalPath.length > 5) {
    recommendations.push({
      type: 'parallel-execution',
      priority: 'high',
      description: `Critical path has ${criticalPath.length} sequential tasks. Look for parallelization opportunities.`,
      descriptionRo: `Calea critică are ${criticalPath.length} sarcini secvențiale. Căutați oportunități de paralelizare.`,
      affectedTasks: criticalPath.slice(0, 5),
      expectedImprovementDays: Math.round(totalDuration * 0.1),
    });
  }

  // Recommend buffer for critical tasks without it
  for (const taskId of criticalPath) {
    const opt = optimizedSchedule.find(t => t.id === taskId);
    if (opt && opt.bufferDays < 3) {
      recommendations.push({
        type: 'add-buffer',
        priority: 'high',
        description: `Critical task "${opt.name}" has only ${opt.bufferDays} buffer days. Consider adding more.`,
        descriptionRo: `Sarcina critică "${opt.name}" are doar ${opt.bufferDays} zile tampon. Luați în considerare adăugarea mai multor zile.`,
        affectedTasks: [taskId],
        expectedImprovementDays: 5,
      });
    }
  }

  // Resource conflict recommendations
  for (const conflict of resourceConflicts) {
    recommendations.push({
      type: 'reallocate-resource',
      priority: conflict.overloadPercentage > 50 ? 'high' : 'medium',
      description: `${conflict.resourceName} is overloaded by ${conflict.overloadPercentage}%. ${conflict.resolution}`,
      descriptionRo: `${conflict.resourceName} este supraîncărcat cu ${conflict.overloadPercentage}%. Redistribuiți sarcinile.`,
      affectedTasks: conflict.conflictingTasks.map(t => t.taskId),
      expectedImprovementDays: Math.round(conflict.overloadPercentage / 20),
    });
  }

  // Feasibility score
  const criticalPathRatio = criticalPath.length / Math.max(input.tasks.length, 1);
  const conflictPenalty = resourceConflicts.length * 10;
  const bottleneckPenalty = bottlenecks.filter(b => b.severity === 'critical').length * 15
    + bottlenecks.filter(b => b.severity === 'high').length * 8;
  const feasibilityScore = Math.max(0, Math.min(100,
    100 - (criticalPathRatio * 20) - conflictPenalty - bottleneckPenalty
  ));

  // Calculate project end date from optimized schedule
  const endDates = optimizedSchedule.map(t => t.optimizedEnd).sort();
  const projectEndDate = endDates[endDates.length - 1] ?? input.projectEnd;

  return {
    optimizedSchedule,
    criticalPath,
    bottlenecks,
    recommendations: recommendations.slice(0, 10),
    resourceConflicts,
    feasibilityScore: Math.round(feasibilityScore),
    totalDuration,
    bufferUtilization: Math.round(
      optimizedSchedule.reduce((sum, t) => sum + t.bufferDays, 0) /
      Math.max(totalDuration, 1) * 100
    ),
    projectEndDate,
  };
}

// ─── What-If Scenario Analysis ───────────────────────────────────

export async function analyzeScenario(
  input: TimelineOptimizationInput,
  scenario: WhatIfScenario
): Promise<ScenarioResult> {
  // Apply scenario changes to a copy of tasks
  let modifiedTasks = [...input.tasks.map(t => ({ ...t }))];

  for (const change of scenario.changes) {
    switch (change.type) {
      case 'delay-task': {
        const task = modifiedTasks.find(t => t.id === change.taskId);
        if (task && change.delayDays) {
          const newStart = new Date(task.start);
          newStart.setDate(newStart.getDate() + change.delayDays);
          const newEnd = new Date(task.end);
          newEnd.setDate(newEnd.getDate() + change.delayDays);
          task.start = newStart.toISOString().slice(0, 10);
          task.end = newEnd.toISOString().slice(0, 10);
        }
        break;
      }
      case 'remove-task':
        modifiedTasks = modifiedTasks.filter(t => t.id !== change.taskId);
        // Remove from dependencies too
        for (const t of modifiedTasks) {
          t.dependencies = t.dependencies.filter(d => d !== change.taskId);
        }
        break;
      case 'add-task':
        if (change.newTask) modifiedTasks.push(change.newTask);
        break;
      case 'change-duration': {
        const task = modifiedTasks.find(t => t.id === change.taskId);
        if (task && change.newDuration) {
          const start = new Date(task.start);
          const newEnd = new Date(start);
          newEnd.setDate(newEnd.getDate() + change.newDuration);
          task.end = newEnd.toISOString().slice(0, 10);
        }
        break;
      }
      case 'change-resource': {
        const task = modifiedTasks.find(t => t.id === change.taskId);
        if (task && change.newResource) {
          task.assignedResources = [change.newResource];
        }
        break;
      }
    }
  }

  // Run optimization on modified tasks
  const baseResult = await optimizeTimeline(input);
  const scenarioResult = await optimizeTimeline({ ...input, tasks: modifiedTasks });

  const baseEnd = new Date(baseResult.projectEndDate);
  const scenarioEnd = new Date(scenarioResult.projectEndDate);
  const delayDays = Math.round((scenarioEnd.getTime() - baseEnd.getTime()) / (1000 * 60 * 60 * 24));

  const affectedTasks = scenarioResult.optimizedSchedule
    .filter(t => {
      const base = baseResult.optimizedSchedule.find(b => b.id === t.id);
      return base && (base.optimizedStart !== t.optimizedStart || base.optimizedEnd !== t.optimizedEnd);
    })
    .map(t => t.id);

  return {
    scenarioName: scenario.name,
    feasible: scenarioResult.feasibilityScore >= 40,
    newEndDate: scenarioResult.projectEndDate,
    delayDays: Math.max(0, delayDays),
    affectedTasks,
    newCriticalPath: scenarioResult.criticalPath,
    feasibilityScore: scenarioResult.feasibilityScore,
    summary: `Scenario "${scenario.name}": ${delayDays > 0 ? `delays project by ${delayDays} days` : 'no delay impact'}. Feasibility: ${scenarioResult.feasibilityScore}/100. ${affectedTasks.length} tasks affected.`,
    summaryRo: `Scenariul "${scenario.name}": ${delayDays > 0 ? `întârzie proiectul cu ${delayDays} zile` : 'fără impact asupra termenului'}. Fezabilitate: ${scenarioResult.feasibilityScore}/100. ${affectedTasks.length} sarcini afectate.`,
  };
}

// ─── Quick Feasibility Check ─────────────────────────────────────

export function quickFeasibilityCheck(tasks: TimelineTask[], projectEnd: string): {
  feasible: boolean;
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  const endDate = new Date(projectEnd);

  // Check if any task extends beyond project end
  for (const task of tasks) {
    if (new Date(task.end) > endDate) {
      issues.push(`Task "${task.name}" ends after project deadline`);
    }
  }

  // Check for circular dependencies
  const visited = new Set<string>();
  const stack = new Set<string>();
  function hasCycle(id: string): boolean {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    const task = tasks.find(t => t.id === id);
    if (task) {
      for (const dep of task.dependencies) {
        if (hasCycle(dep)) return true;
      }
    }
    stack.delete(id);
    return false;
  }
  for (const task of tasks) {
    if (hasCycle(task.id)) {
      issues.push('Circular dependency detected');
      break;
    }
  }

  // Check for missing dependencies
  const taskIds = new Set(tasks.map(t => t.id));
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!taskIds.has(dep)) {
        issues.push(`Task "${task.name}" depends on non-existent task "${dep}"`);
      }
    }
  }

  const score = Math.max(0, 100 - issues.length * 25);
  return { feasible: issues.length === 0, score, issues };
}
