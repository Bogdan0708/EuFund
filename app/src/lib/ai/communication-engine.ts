// ─── Advanced Notification & Communication Intelligence ──────────
// Context-aware notifications, escalation management, bilingual
// communication, and meeting scheduling intelligence.

// ─── Types ───────────────────────────────────────────────────────

export type UserRole = 'coordinator' | 'partner-lead' | 'researcher' | 'financial-officer' | 'project-manager' | 'auditor' | 'stakeholder';
export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SmartNotification {
  id: string;
  urgencyLevel: UrgencyLevel;
  recipientRoles: UserRole[];
  recipientIds?: string[];
  messageContent: { ro: string; en: string };
  subject: { ro: string; en: string };
  actionRequired: boolean;
  deadline?: string;
  escalationPath?: string[];
  category: NotificationCategory;
  relatedEntityId?: string;
  relatedEntityType?: 'task' | 'deliverable' | 'milestone' | 'budget' | 'partner' | 'compliance';
  createdAt: string;
  expiresAt?: string;
}

export type NotificationCategory =
  | 'deadline-approaching'
  | 'deadline-missed'
  | 'budget-alert'
  | 'compliance-issue'
  | 'deliverable-due'
  | 'partner-issue'
  | 'milestone-reached'
  | 'risk-escalation'
  | 'meeting-reminder'
  | 'report-due'
  | 'general';

export interface EscalationRule {
  triggerCondition: string;
  initialLevel: UrgencyLevel;
  escalationSteps: {
    afterDays: number;
    newLevel: UrgencyLevel;
    notifyRoles: UserRole[];
    action: string;
  }[];
}

export interface MeetingSchedule {
  title: { ro: string; en: string };
  suggestedSlots: { start: string; end: string; score: number }[];
  requiredParticipants: string[];
  optionalParticipants: string[];
  agenda: { item: string; duration: number; presenter?: string }[];
  timezone: string;
  isOnline: boolean;
}

export interface CommunicationPlan {
  stakeholderGroups: {
    role: UserRole;
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
    channels: ('email' | 'platform' | 'meeting' | 'report')[];
    contentLevel: 'summary' | 'detailed' | 'technical';
    language: 'ro' | 'en' | 'both';
  }[];
  scheduledCommunications: {
    type: string;
    frequency: string;
    nextDate: string;
    recipients: UserRole[];
  }[];
}

// ─── Input Types ─────────────────────────────────────────────────

export interface NotificationInput {
  projectId: string;
  event: {
    type: NotificationCategory;
    entityId?: string;
    entityType?: SmartNotification['relatedEntityType'];
    title: string;
    description: string;
    severity?: UrgencyLevel;
    dueDate?: string;
    daysUntilDeadline?: number;
  };
  projectContext: {
    coordinatorId?: string;
    partnerLeadIds?: string[];
    financialOfficerIds?: string[];
  };
}

export interface MeetingInput {
  title: string;
  participantIds: string[];
  participantAvailability?: {
    id: string;
    timezone: string;
    busySlots: { start: string; end: string }[];
  }[];
  duration: number; // minutes
  preferredTimeRange?: { start: string; end: string }; // time of day
  isOnline?: boolean;
  agendaItems?: { item: string; duration: number; presenter?: string }[];
}

// ─── Notification Generation ─────────────────────────────────────

const ROLE_ROUTING: Record<NotificationCategory, UserRole[]> = {
  'deadline-approaching': ['coordinator', 'project-manager', 'partner-lead'],
  'deadline-missed': ['coordinator', 'project-manager', 'partner-lead', 'stakeholder'],
  'budget-alert': ['coordinator', 'financial-officer', 'project-manager'],
  'compliance-issue': ['coordinator', 'financial-officer', 'auditor'],
  'deliverable-due': ['partner-lead', 'researcher', 'coordinator'],
  'partner-issue': ['coordinator', 'project-manager'],
  'milestone-reached': ['coordinator', 'stakeholder', 'project-manager'],
  'risk-escalation': ['coordinator', 'project-manager', 'stakeholder'],
  'meeting-reminder': ['coordinator', 'partner-lead', 'researcher', 'financial-officer'],
  'report-due': ['coordinator', 'financial-officer', 'project-manager'],
  'general': ['coordinator', 'project-manager'],
};

function determineUrgency(input: NotificationInput): UrgencyLevel {
  if (input.event.severity) return input.event.severity;

  const { type, daysUntilDeadline } = input.event;

  if (type === 'deadline-missed' || type === 'compliance-issue') return 'critical';
  if (type === 'risk-escalation') return 'high';
  if (type === 'budget-alert') return daysUntilDeadline != null && daysUntilDeadline < 7 ? 'high' : 'medium';
  if (type === 'deadline-approaching') {
    if (daysUntilDeadline != null) {
      if (daysUntilDeadline <= 3) return 'critical';
      if (daysUntilDeadline <= 7) return 'high';
      if (daysUntilDeadline <= 14) return 'medium';
    }
    return 'low';
  }
  if (type === 'milestone-reached') return 'low';

  return 'medium';
}

function generateBilingualMessage(input: NotificationInput, urgency: UrgencyLevel): { subject: { ro: string; en: string }; body: { ro: string; en: string } } {
  const { type, title, description, daysUntilDeadline, dueDate } = input.event;
  const urgencyPrefix: Record<UrgencyLevel, { en: string; ro: string }> = {
    critical: { en: '🔴 CRITICAL', ro: '🔴 CRITIC' },
    high: { en: '🟠 URGENT', ro: '🟠 URGENT' },
    medium: { en: '🟡 ATTENTION', ro: '🟡 ATENȚIE' },
    low: { en: 'ℹ️ INFO', ro: 'ℹ️ INFO' },
  };

  const prefix = urgencyPrefix[urgency];
  const deadlineStr = dueDate ? ` (${dueDate})` : daysUntilDeadline ? ` (${daysUntilDeadline} days)` : '';
  const deadlineStrRo = dueDate ? ` (${dueDate})` : daysUntilDeadline ? ` (${daysUntilDeadline} zile)` : '';

  const messageTemplates: Record<NotificationCategory, { en: string; ro: string }> = {
    'deadline-approaching': {
      en: `${prefix.en}: Deadline approaching for "${title}"${deadlineStr}. ${description}`,
      ro: `${prefix.ro}: Termen limită se apropie pentru "${title}"${deadlineStrRo}. ${description}`,
    },
    'deadline-missed': {
      en: `${prefix.en}: Deadline MISSED for "${title}"${deadlineStr}. Immediate action required. ${description}`,
      ro: `${prefix.ro}: Termen limită DEPĂȘIT pentru "${title}"${deadlineStrRo}. Acțiune imediată necesară. ${description}`,
    },
    'budget-alert': {
      en: `${prefix.en}: Budget alert - ${title}. ${description}`,
      ro: `${prefix.ro}: Alertă buget - ${title}. ${description}`,
    },
    'compliance-issue': {
      en: `${prefix.en}: Compliance issue detected - ${title}. ${description}`,
      ro: `${prefix.ro}: Problemă de conformitate detectată - ${title}. ${description}`,
    },
    'deliverable-due': {
      en: `${prefix.en}: Deliverable "${title}" is due${deadlineStr}. ${description}`,
      ro: `${prefix.ro}: Livrabilul "${title}" este scadent${deadlineStrRo}. ${description}`,
    },
    'partner-issue': {
      en: `${prefix.en}: Partner issue - ${title}. ${description}`,
      ro: `${prefix.ro}: Problemă partener - ${title}. ${description}`,
    },
    'milestone-reached': {
      en: `${prefix.en}: Milestone achieved - ${title}! ${description}`,
      ro: `${prefix.ro}: Jalon atins - ${title}! ${description}`,
    },
    'risk-escalation': {
      en: `${prefix.en}: Risk escalation - ${title}. ${description}`,
      ro: `${prefix.ro}: Escaladare risc - ${title}. ${description}`,
    },
    'meeting-reminder': {
      en: `${prefix.en}: Meeting reminder - ${title}${deadlineStr}. ${description}`,
      ro: `${prefix.ro}: Memento întâlnire - ${title}${deadlineStrRo}. ${description}`,
    },
    'report-due': {
      en: `${prefix.en}: Report due - ${title}${deadlineStr}. ${description}`,
      ro: `${prefix.ro}: Raport scadent - ${title}${deadlineStrRo}. ${description}`,
    },
    'general': {
      en: `${prefix.en}: ${title}. ${description}`,
      ro: `${prefix.ro}: ${title}. ${description}`,
    },
  };

  const template = messageTemplates[type] ?? messageTemplates.general;

  return {
    subject: {
      en: `[${prefix.en}] ${title}`,
      ro: `[${prefix.ro}] ${title}`,
    },
    body: template,
  };
}

export function generateNotification(input: NotificationInput): SmartNotification {
  const urgency = determineUrgency(input);
  const roles = ROLE_ROUTING[input.event.type] ?? ROLE_ROUTING.general;
  const { subject, body } = generateBilingualMessage(input, urgency);

  // Escalation path for high/critical
  const escalationPath: string[] = [];
  if (urgency === 'critical' || urgency === 'high') {
    if (input.projectContext.coordinatorId) escalationPath.push(input.projectContext.coordinatorId);
    escalationPath.push('program-officer', 'management-board');
  }

  return {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    urgencyLevel: urgency,
    recipientRoles: roles,
    messageContent: body,
    subject,
    actionRequired: urgency === 'critical' || urgency === 'high' || input.event.type === 'deadline-missed',
    deadline: input.event.dueDate,
    escalationPath: escalationPath.length > 0 ? escalationPath : undefined,
    category: input.event.type,
    relatedEntityId: input.event.entityId,
    relatedEntityType: input.event.entityType,
    createdAt: new Date().toISOString(),
    expiresAt: input.event.dueDate,
  };
}

// ─── Batch Notification Generation ───────────────────────────────

export function generateProjectNotifications(
  deadlines: { name: string; date: string; type: SmartNotification['relatedEntityType']; entityId: string }[],
  projectId: string,
  projectContext: NotificationInput['projectContext']
): SmartNotification[] {
  const now = new Date();
  const notifications: SmartNotification[] = [];

  for (const deadline of deadlines) {
    const dueDate = new Date(deadline.date);
    const daysUntil = Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
      notifications.push(generateNotification({
        projectId,
        event: {
          type: 'deadline-missed',
          entityId: deadline.entityId,
          entityType: deadline.type,
          title: deadline.name,
          description: `Overdue by ${Math.abs(daysUntil)} days.`,
          daysUntilDeadline: daysUntil,
          dueDate: deadline.date,
        },
        projectContext,
      }));
    } else if (daysUntil <= 14) {
      notifications.push(generateNotification({
        projectId,
        event: {
          type: 'deadline-approaching',
          entityId: deadline.entityId,
          entityType: deadline.type,
          title: deadline.name,
          description: `Due in ${daysUntil} days.`,
          daysUntilDeadline: daysUntil,
          dueDate: deadline.date,
        },
        projectContext,
      }));
    }
  }

  return notifications.sort((a, b) => {
    const u: Record<UrgencyLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return u[a.urgencyLevel] - u[b.urgencyLevel];
  });
}

// ─── Default Escalation Rules ────────────────────────────────────

export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  {
    triggerCondition: 'deliverable-overdue',
    initialLevel: 'high',
    escalationSteps: [
      { afterDays: 3, newLevel: 'critical', notifyRoles: ['coordinator'], action: 'Send reminder to partner lead' },
      { afterDays: 7, newLevel: 'critical', notifyRoles: ['coordinator', 'stakeholder'], action: 'Schedule emergency call with partner' },
      { afterDays: 14, newLevel: 'critical', notifyRoles: ['coordinator', 'stakeholder', 'auditor'], action: 'Formal notice to partner organization' },
    ],
  },
  {
    triggerCondition: 'budget-overrun',
    initialLevel: 'high',
    escalationSteps: [
      { afterDays: 1, newLevel: 'critical', notifyRoles: ['coordinator', 'financial-officer'], action: 'Freeze non-essential spending' },
      { afterDays: 5, newLevel: 'critical', notifyRoles: ['coordinator', 'stakeholder'], action: 'Prepare budget amendment request' },
    ],
  },
  {
    triggerCondition: 'compliance-violation',
    initialLevel: 'critical',
    escalationSteps: [
      { afterDays: 0, newLevel: 'critical', notifyRoles: ['coordinator', 'financial-officer', 'auditor'], action: 'Immediate compliance review' },
      { afterDays: 3, newLevel: 'critical', notifyRoles: ['coordinator', 'stakeholder'], action: 'Report to program officer if unresolved' },
    ],
  },
];

// ─── Meeting Scheduling ──────────────────────────────────────────

export function suggestMeetingSlots(input: MeetingInput): MeetingSchedule {
  const slots: MeetingSchedule['suggestedSlots'] = [];

  // Default: suggest slots for the next 5 business days, 9:00-17:00 CET
  const now = new Date();
  for (let d = 1; d <= 7 && slots.length < 5; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    // Morning and afternoon slots
    for (const hour of [9, 10, 14, 15]) {
      const start = new Date(day);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + input.duration);

      // Check against busy slots
      let conflicts = 0;
      for (const participant of input.participantAvailability ?? []) {
        for (const busy of participant.busySlots) {
          if (start.toISOString() < busy.end && end.toISOString() > busy.start) {
            conflicts++;
          }
        }
      }

      const participantCount = input.participantAvailability?.length ?? input.participantIds.length;
      const availabilityScore = participantCount > 0
        ? Math.round(((participantCount - conflicts) / participantCount) * 100)
        : 80;

      if (availabilityScore >= 50) {
        slots.push({
          start: start.toISOString(),
          end: end.toISOString(),
          score: availabilityScore,
        });
      }
    }
  }

  slots.sort((a, b) => b.score - a.score);

  return {
    title: { en: input.title, ro: input.title },
    suggestedSlots: slots.slice(0, 5),
    requiredParticipants: input.participantIds,
    optionalParticipants: [],
    agenda: input.agendaItems ?? [],
    timezone: 'Europe/Bucharest',
    isOnline: input.isOnline ?? true,
  };
}

// ─── Communication Plan Generation ───────────────────────────────

export function generateCommunicationPlan(partners: { name: string; role: UserRole; country: string }[]): CommunicationPlan {
  void partners;
  return {
    stakeholderGroups: [
      { role: 'coordinator', frequency: 'weekly', channels: ['email', 'platform', 'meeting'], contentLevel: 'detailed', language: 'both' },
      { role: 'partner-lead', frequency: 'biweekly', channels: ['email', 'platform', 'meeting'], contentLevel: 'detailed', language: 'both' },
      { role: 'researcher', frequency: 'monthly', channels: ['platform'], contentLevel: 'technical', language: 'en' },
      { role: 'financial-officer', frequency: 'monthly', channels: ['email', 'report'], contentLevel: 'detailed', language: 'both' },
      { role: 'stakeholder', frequency: 'quarterly', channels: ['email', 'report'], contentLevel: 'summary', language: 'en' },
      { role: 'auditor', frequency: 'quarterly', channels: ['report'], contentLevel: 'detailed', language: 'en' },
    ],
    scheduledCommunications: [
      { type: 'Consortium meeting', frequency: 'Monthly', nextDate: getNextMonthlyDate(), recipients: ['coordinator', 'partner-lead'] },
      { type: 'Financial review', frequency: 'Quarterly', nextDate: getNextQuarterlyDate(), recipients: ['coordinator', 'financial-officer'] },
      { type: 'Progress report', frequency: 'Monthly', nextDate: getNextMonthlyDate(), recipients: ['coordinator', 'stakeholder'] },
      { type: 'Risk review', frequency: 'Biweekly', nextDate: getNextBiweeklyDate(), recipients: ['coordinator', 'project-manager'] },
    ],
  };
}

function getNextMonthlyDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}

function getNextQuarterlyDate(): string {
  const d = new Date();
  const currentQuarter = Math.floor(d.getMonth() / 3);
  d.setMonth((currentQuarter + 1) * 3, 1);
  return d.toISOString().slice(0, 10);
}

function getNextBiweeklyDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}
