import {
  pgTable, pgEnum, uuid, varchar, text, boolean, integer, decimal,
  timestamp, jsonb, inet, bigint, date, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────
export const userRoleEnum = pgEnum('user_role', ['admin', 'org_admin', 'project_manager', 'viewer']);
export const orgTypeEnum = pgEnum('org_type', ['srl', 'sa', 'pfa', 'ong', 'uat', 'institutie_publica', 'altul']);
export const orgSizeEnum = pgEnum('org_size', ['micro', 'mica', 'medie', 'mare']);
export const programStatusEnum = pgEnum('program_status', ['activ', 'inactiv', 'arhivat']);
export const callStatusEnum = pgEnum('call_status', ['previzionat', 'deschis', 'in_evaluare', 'inchis', 'anulat']);
export const projectStatusEnum = pgEnum('project_status', [
  'ciorna', 'in_lucru', 'verificare', 'finalizat', 'depus', 'aprobat', 'respins', 'arhivat',
]);
export const legislationTypeEnum = pgEnum('legislation_type', [
  'regulament_eu', 'directiva_eu', 'oug', 'hg', 'lege', 'ordin', 'ghid', 'instructiune',
]);
export const docTypeEnum = pgEnum('doc_type', [
  'ghid_solicitant', 'bilant', 'certificat', 'aviz', 'studiu_fezabilitate',
  'plan_afaceri', 'deviz', 'acord_parteneriat', 'declaratie', 'altul',
]);
export const notifTypeEnum = pgEnum('notif_type', [
  'deadline', 'apel_nou', 'legislatie_update', 'compliance', 'system', 'colaborare',
]);
export const consentTypeEnum = pgEnum('consent_type', [
  'privacy_policy', 'terms_of_service', 'data_processing', 'marketing', 'analytics',
]);
export const consentStatusEnum = pgEnum('consent_status', ['granted', 'withdrawn', 'expired']);

// ─── Users ───────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  preferredLang: varchar('preferred_lang', { length: 5 }).default('ro'),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  emailVerified: boolean('email_verified').default(false),
  mfaEnabled: boolean('mfa_enabled').default(false),
  mfaSecret: varchar('mfa_secret', { length: 255 }),
  dateOfBirth: date('date_of_birth'), // For age verification (Law 190/2018)
  ageVerified: boolean('age_verified').default(false), // 16+ confirmed
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ─── Consent Records (GDPR + Law 190/2018) ──────────────────────
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  consentType: consentTypeEnum('consent_type').notNull(),
  status: consentStatusEnum('status').notNull().default('granted'),
  version: varchar('version', { length: 50 }).notNull(), // Policy version consented to
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  userIdx: index('idx_consent_user').on(table.userId),
}));

// ─── Organizations ──────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 500 }).notNull(),
  cui: varchar('cui', { length: 20 }).unique(),
  regCom: varchar('reg_com', { length: 30 }),
  orgType: orgTypeEnum('org_type').notNull(),
  orgSize: orgSizeEnum('org_size'),
  caenPrimary: varchar('caen_primary', { length: 10 }),
  caenSecondary: text('caen_secondary').array(),
  address: jsonb('address'), // {street, city, county, postalCode}
  nutsRegion: varchar('nuts_region', { length: 10 }),
  legalRepName: varchar('legal_rep_name', { length: 255 }),
  legalRepRole: varchar('legal_rep_role', { length: 100 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  website: varchar('website', { length: 500 }),
  foundedDate: date('founded_date'),
  employeeCount: integer('employee_count'),
  annualRevenue: decimal('annual_revenue', { precision: 15, scale: 2 }),
  isVatPayer: boolean('is_vat_payer').default(true),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  cuiIdx: index('idx_org_cui').on(table.cui),
  typeIdx: index('idx_org_type').on(table.orgType),
  regionIdx: index('idx_org_region').on(table.nutsRegion),
}));

// ─── Organization Members ───────────────────────────────────────
export const orgMembers = pgTable('org_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: userRoleEnum('role').notNull().default('viewer'),
  invitedBy: uuid('invited_by').references(() => users.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueMember: uniqueIndex('idx_org_member_unique').on(table.orgId, table.userId),
}));

// ─── Funding Programs ───────────────────────────────────────────
export const fundingPrograms = pgTable('funding_programs', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).unique().notNull(),
  nameRo: varchar('name_ro', { length: 500 }).notNull(),
  nameEn: varchar('name_en', { length: 500 }),
  descriptionRo: text('description_ro'),
  descriptionEn: text('description_en'),
  managingAuth: varchar('managing_auth', { length: 255 }),
  fundSource: varchar('fund_source', { length: 50 }),
  totalBudget: decimal('total_budget', { precision: 15, scale: 2 }),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  websiteUrl: varchar('website_url', { length: 500 }),
  status: programStatusEnum('status').default('activ'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Calls for Proposals ────────────────────────────────────────
export const callsForProposals = pgTable('calls_for_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  programId: uuid('program_id').notNull().references(() => fundingPrograms.id),
  callCode: varchar('call_code', { length: 100 }).notNull(),
  titleRo: varchar('title_ro', { length: 1000 }).notNull(),
  titleEn: varchar('title_en', { length: 1000 }),
  descriptionRo: text('description_ro'),
  objective: text('objective'),
  eligibleTypes: text('eligible_types').array(),
  eligibleRegions: text('eligible_regions').array(),
  eligibleCaen: text('eligible_caen').array(),
  budgetTotal: decimal('budget_total', { precision: 15, scale: 2 }),
  budgetMin: decimal('budget_min', { precision: 15, scale: 2 }),
  budgetMax: decimal('budget_max', { precision: 15, scale: 2 }),
  cofinancingRate: decimal('cofinancing_rate', { precision: 5, scale: 2 }),
  durationMin: integer('duration_min'),
  durationMax: integer('duration_max'),
  submissionStart: timestamp('submission_start', { withTimezone: true }),
  submissionEnd: timestamp('submission_end', { withTimezone: true }),
  guideUrl: varchar('guide_url', { length: 500 }),
  status: callStatusEnum('status').default('previzionat'),
  isCompetitive: boolean('is_competitive').default(true),
  evaluationCriteria: jsonb('evaluation_criteria'),
  eligibleExpenses: jsonb('eligible_expenses'),
  stateAidScheme: varchar('state_aid_scheme', { length: 255 }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  programIdx: index('idx_calls_program').on(table.programId),
  statusIdx: index('idx_calls_status').on(table.status),
  deadlineIdx: index('idx_calls_deadline').on(table.submissionEnd),
}));

// ─── Projects ───────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  callId: uuid('call_id').references(() => callsForProposals.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  title: varchar('title', { length: 1000 }).notNull(),
  acronym: varchar('acronym', { length: 50 }),
  status: projectStatusEnum('status').default('ciorna'),
  currentVersion: integer('current_version').default(1),
  startDate: date('start_date'),
  endDate: date('end_date'),
  durationMonths: integer('duration_months'),
  totalBudget: decimal('total_budget', { precision: 15, scale: 2 }),
  euContribution: decimal('eu_contribution', { precision: 15, scale: 2 }),
  nationalContrib: decimal('national_contrib', { precision: 15, scale: 2 }),
  ownContrib: decimal('own_contrib', { precision: 15, scale: 2 }),
  sectionSummary: text('section_summary'),
  sectionContext: text('section_context'),
  sectionObjectives: jsonb('section_objectives'),
  sectionMethodology: jsonb('section_methodology'),
  sectionBudget: jsonb('section_budget'),
  sectionIndicators: jsonb('section_indicators'),
  sectionSustainability: text('section_sustainability'),
  sectionPartnership: jsonb('section_partnership'),
  sectionRisks: jsonb('section_risks'),
  sectionCustom: jsonb('section_custom').default({}),
  complianceScore: decimal('compliance_score', { precision: 5, scale: 2 }),
  lastComplianceCheck: timestamp('last_compliance_check', { withTimezone: true }),
  matchScore: decimal('match_score', { precision: 5, scale: 2 }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  orgIdx: index('idx_projects_org').on(table.orgId),
  callIdx: index('idx_projects_call').on(table.callId),
  statusIdx: index('idx_projects_status').on(table.status),
}));

// ─── Project Versions ───────────────────────────────────────────
export const projectVersions = pgTable('project_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  versionNumber: integer('version_number').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  changedBy: uuid('changed_by').notNull().references(() => users.id),
  changeSummary: text('change_summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueVersion: uniqueIndex('idx_project_version_unique').on(table.projectId, table.versionNumber),
}));

// ─── Project Comments ───────────────────────────────────────────
export const projectComments = pgTable('project_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  section: varchar('section', { length: 100 }),
  content: text('content').notNull(),
  resolved: boolean('resolved').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Legislation ────────────────────────────────────────────────
export const legislationDocuments = pgTable('legislation_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  extId: varchar('ext_id', { length: 255 }).unique(),
  type: legislationTypeEnum('type').notNull(),
  titleRo: text('title_ro').notNull(),
  titleEn: text('title_en'),
  issuer: varchar('issuer', { length: 255 }),
  number: varchar('number', { length: 50 }),
  publishedDate: date('published_date'),
  effectiveDate: date('effective_date'),
  expiryDate: date('expiry_date'),
  sourceUrl: varchar('source_url', { length: 500 }),
  fullText: text('full_text'),
  relevanceTags: text('relevance_tags').array(),
  programs: text('programs').array(),
  isActive: boolean('is_active').default(true),
  supersededBy: uuid('superseded_by'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  typeIdx: index('idx_legislation_type').on(table.type),
  activeIdx: index('idx_legislation_active').on(table.isActive),
}));

// ─── Documents ──────────────────────────────────────────────────
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id),
  projectId: uuid('project_id').references(() => projects.id),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  docType: docTypeEnum('doc_type').notNull(),
  filename: varchar('filename', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }),
  fileSize: bigint('file_size', { mode: 'number' }),
  storagePath: varchar('storage_path', { length: 500 }).notNull(),
  encryptionKeyId: varchar('encryption_key_id', { length: 100 }),
  ocrText: text('ocr_text'),
  aiSummary: text('ai_summary'),
  extractedData: jsonb('extracted_data'),
  checksumSha256: varchar('checksum_sha256', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  orgIdx: index('idx_documents_org').on(table.orgId),
  projectIdx: index('idx_documents_project').on(table.projectId),
}));

// ─── Compliance Reports ─────────────────────────────────────────
export const complianceReports = pgTable('compliance_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  generatedBy: uuid('generated_by').notNull().references(() => users.id),
  overallScore: decimal('overall_score', { precision: 5, scale: 2 }),
  items: jsonb('items').notNull(),
  modelUsed: varchar('model_used', { length: 100 }),
  tokensUsed: integer('tokens_used'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Notifications ──────────────────────────────────────────────
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: notifTypeEnum('type').notNull(),
  titleRo: varchar('title_ro', { length: 500 }).notNull(),
  bodyRo: text('body_ro'),
  link: varchar('link', { length: 500 }),
  isRead: boolean('is_read').default(false),
  sentEmail: boolean('sent_email').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userUnreadIdx: index('idx_notif_user_unread').on(table.userId, table.isRead),
}));

// ─── Audit Log (GDPR-compliant, append-only) ────────────────────
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: uuid('resource_id'),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata').default({}), // Extra context (consent_id, legal_basis, etc.)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdx: index('idx_audit_user').on(table.userId),
  resourceIdx: index('idx_audit_resource').on(table.resourceType, table.resourceId),
  createdIdx: index('idx_audit_created').on(table.createdAt),
}));
