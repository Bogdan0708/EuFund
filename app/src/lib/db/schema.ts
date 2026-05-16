import {
  pgTable, pgEnum, uuid, varchar, text, boolean, integer, decimal,
  timestamp, jsonb, inet, bigint, date, index, uniqueIndex, unique, real,
} from 'drizzle-orm/pg-core';
import { relations, sql, desc } from 'drizzle-orm';

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
export const workPackageStatusEnum = pgEnum('work_package_status', ['planned', 'active', 'completed', 'delayed', 'cancelled']);
export const riskLevelEnum = pgEnum('risk_level', ['very_low', 'low', 'medium', 'high', 'very_high']);
export const userTierEnum = pgEnum('user_tier', ['free', 'plus', 'pro', 'enterprise', 'ultra']);

export const fundingInstrumentType = pgEnum('funding_instrument_type', [
  'grant',
  'state_aid',
  'de_minimis',
  'loan',
  'guarantee',
  'equity',
  'combined'
]);

export const implementingChannel = pgEnum('implementing_channel', [
  'mysmis',
  'pnrr_portal',
  'bank_network',
  'afm_portal',
  'minister_portal',
  'e_licitatie'
]);
export const connectorAccessMethodEnum = pgEnum('connector_access_method', ['api', 'html', 'pdf', 'docx', 'rss', 'manual']);
export const connectorRunStatusEnum = pgEnum('connector_run_status', ['running', 'success', 'failed', 'partial']);
export const extractionMethodEnum = pgEnum('extraction_method', ['regex', 'rule', 'llm', 'hybrid']);
export const reviewSeverityEnum = pgEnum('review_severity', ['low', 'medium', 'high', 'critical']);
export const reviewStatusEnum = pgEnum('review_status', ['pending', 'in_review', 'approved', 'rejected']);

// New enums for orchestrator redesign
export const workflowStatusEnum = pgEnum('workflow_status', [
  'active', 'paused', 'completed', 'abandoned'
])
export const workflowMessageRoleEnum = pgEnum('workflow_message_role', [
  'user', 'assistant', 'system'
])
export const discoveryMethodEnum = pgEnum('discovery_method', [
  'crawler', 'perplexity', 'manual'
])
export const discoveryStatusEnum = pgEnum('discovery_status', [
  'pending_review', 'approved', 'rejected', 'expired'
])
export const alertUrgencyEnum = pgEnum('alert_urgency', ['daily'])
export const projectDocStatusEnum = pgEnum('project_doc_status', [
  'draft', 'review', 'final'
])
export const fileCategory = pgEnum('file_category', ['uploaded', 'generated'])
export const projectStatusEnumV2 = pgEnum('project_status_v2', [
  'draft', 'action_plan', 'built', 'exported'
])

// ─── Users ───────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  preferredLang: varchar('preferred_lang', { length: 5 }).default('ro'),
  tier: userTierEnum('tier').default('free'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  subscriptionStatus: varchar('subscription_status', { length: 50 }).default('none'),
  subscriptionPeriodEnd: timestamp('subscription_period_end', { withTimezone: true }),
  apiCallsThisMonth: integer('api_calls_this_month').default(0),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  emailVerified: boolean('email_verified').default(false),
  mfaEnabled: boolean('mfa_enabled').default(false),
  mfaSecret: varchar('mfa_secret', { length: 255 }),
  isPlatformAdmin: boolean('is_platform_admin').default(false),
  dateOfBirth: date('date_of_birth'), // For age verification (Law 190/2018)
  ageVerified: boolean('age_verified').default(false), // 16+ confirmed
  onboardingCompleted: boolean('onboarding_completed').default(false),
  interests: text('interests').array(),  // e.g., ['digitalization', 'green_energy']
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  stripeCustomerIdx: index('idx_users_stripe_customer').on(table.stripeCustomerId),
}));

// ─── NextAuth Accounts (OAuth linking) ─────────────────────────
export const authAccounts = pgTable('auth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(), // 'oauth' | 'email' | 'credentials'
  provider: varchar('provider', { length: 50 }).notNull(), // 'google' | 'microsoft-entra-id' | 'facebook'
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  tokenType: varchar('token_type', { length: 50 }),
  scope: text('scope'),
  idToken: text('id_token'),
  sessionState: text('session_state'),
}, (table) => ({
  providerIdx: uniqueIndex('idx_auth_accounts_provider').on(table.provider, table.providerAccountId),
  userIdx: index('idx_auth_accounts_user').on(table.userId),
}));

// ─── NextAuth Verification Tokens (magic links) ───────────────
export const authVerificationTokens = pgTable('auth_verification_tokens', {
  identifier: varchar('identifier', { length: 255 }).notNull(), // email address
  token: varchar('token', { length: 255 }).notNull(),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
}, (table) => ({
  compoundKey: uniqueIndex('idx_auth_verification_tokens_compound').on(table.identifier, table.token),
}));

// ─── Stripe Webhook Events (idempotency) ────────────────────────
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: varchar('event_id', { length: 255 }).unique().notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
});

// ─── Email Verification Tokens ──────────────────────────────────
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdx: index('idx_email_verification_tokens_user').on(table.userId),
  tokenIdx: uniqueIndex('idx_email_verification_tokens_token').on(table.token),
}));

// ─── Password Reset Tokens ──────────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdx: index('idx_password_reset_tokens_user').on(table.userId),
  tokenIdx: uniqueIndex('idx_password_reset_tokens_token').on(table.token),
}));

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
  sourceConnectorId: uuid('source_connector_id').references(() => sourceConnectors.id, { onDelete: 'set null' }),
  externalId: varchar('external_id', { length: 255 }),
  callCode: varchar('call_code', { length: 100 }).notNull(),
  instrumentType: fundingInstrumentType('instrument_type').default('grant'),
  implementingChannel: implementingChannel('implementing_channel').default('mysmis'),
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
  guaranteeRate: decimal('guarantee_rate', { precision: 5, scale: 2 }),
  interestSubsidy: boolean('interest_subsidy').default(false),
  legalBasis: text('legal_basis'),
  officialUrl: text('official_url'),
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
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  // EC Portal fields (nullable — only set for calls imported from EC feed)
  ecExternalId: varchar('ec_external_id', { length: 255 }),
  ecTopics: jsonb('ec_topics'),
  ecEligibilityCriteria: jsonb('ec_eligibility_criteria'),
  ecSourceUrl: text('ec_source_url'),
  ecSyncedAt: timestamp('ec_synced_at'),
  lastVerifiedAt: timestamp('last_verified_at'),
}, (table) => ({
  programIdx: index('idx_calls_program').on(table.programId),
  statusIdx: index('idx_calls_status').on(table.status),
  deadlineIdx: index('idx_calls_deadline').on(table.submissionEnd),
  sourceConnectorIdx: index('idx_calls_connector').on(table.sourceConnectorId),
  uniqueCallCode: uniqueIndex('idx_calls_code_unique').on(table.callCode),
  uniqueExternal: uniqueIndex('idx_calls_unique_external').on(table.sourceConnectorId, table.externalId),
}));

// ─── Projects ───────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  callId: uuid('call_id').references(() => callsForProposals.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  title: varchar('title', { length: 1000 }).notNull(),
  acronym: varchar('acronym', { length: 50 }),
  status: projectStatusEnum('status').default('ciorna'),
  currentVersion: integer('current_version').default(1),
  completionStatus: varchar('completion_status', { length: 30 }),
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

// ─── External Integrations ──────────────────────────────────────
export const externalIntegrations = pgTable('external_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: varchar('provider', { length: 100 }).notNull(),
  credentialRef: varchar('credential_ref', { length: 255 }),
  baseUrl: varchar('base_url', { length: 500 }),
  environment: varchar('environment', { length: 20 }).default('production'),
  rateLimitMax: integer('rate_limit_max').default(10),
  rateLimitWindowMs: integer('rate_limit_window_ms').default(60000),
  isActive: boolean('is_active').default(true),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  lastError: text('last_error'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  providerIdx: uniqueIndex('idx_ext_integration_provider').on(table.provider),
}));

// ─── Legislation Cache ──────────────────────────────────────────
export const legislationCache = pgTable('legislation_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  celex: varchar('celex', { length: 50 }).unique().notNull(),
  title: text('title').notNull(),
  titleRo: text('title_ro'),
  documentType: varchar('document_type', { length: 50 }),
  publishedDate: date('published_date'),
  textRo: text('text_ro'),
  textEn: text('text_en'),
  subjects: text('subjects').array(),
  inForce: boolean('in_force').default(true),
  sourceUrl: varchar('source_url', { length: 500 }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  celexIdx: index('idx_legislation_cache_celex').on(table.celex),
  typeIdx: index('idx_legislation_cache_type').on(table.documentType),
}));

// ─── Funding Calls (Live from EC Portal) ────────────────────────
export const fundingCalls = pgTable('funding_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: varchar('external_id', { length: 255 }).unique().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  programme: varchar('programme', { length: 100 }),
  status: varchar('status', { length: 50 }).default('open'),
  openingDate: timestamp('opening_date', { withTimezone: true }),
  deadlineDate: timestamp('deadline_date', { withTimezone: true }),
  budget: decimal('budget', { precision: 15, scale: 2 }),
  currency: varchar('currency', { length: 10 }).default('EUR'),
  topics: text('topics').array(),
  eligibilityCriteria: jsonb('eligibility_criteria'),
  sourceUrl: varchar('source_url', { length: 500 }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  statusIdx: index('idx_funding_calls_status').on(table.status),
  deadlineIdx: index('idx_funding_calls_deadline').on(table.deadlineDate),
  programmeIdx: index('idx_funding_calls_programme').on(table.programme),
}));

// ─── Funding Source Connectors ─────────────────────────────────
export const sourceConnectors = pgTable('source_connectors', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  owner: varchar('owner', { length: 255 }),
  baseUrl: varchar('base_url', { length: 1000 }),
  accessMethod: connectorAccessMethodEnum('access_method').notNull().default('html'),
  isActive: boolean('is_active').notNull().default(true),
  config: jsonb('config').default({}),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  activeIdx: index('idx_source_connectors_active').on(table.isActive),
}));

// ─── Funding Source Runs ───────────────────────────────────────
export const sourceRuns = pgTable('source_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectorId: uuid('connector_id').notNull().references(() => sourceConnectors.id, { onDelete: 'cascade' }),
  status: connectorRunStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  itemsDiscovered: integer('items_discovered').notNull().default(0),
  itemsChanged: integer('items_changed').notNull().default(0),
  error: text('error'),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  connectorIdx: index('idx_source_runs_connector').on(table.connectorId),
  statusIdx: index('idx_source_runs_status').on(table.status),
}));

// ─── Funding Documents (Raw) ───────────────────────────────────
export const fundingDocumentsRaw = pgTable('funding_documents_raw', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectorId: uuid('connector_id').notNull().references(() => sourceConnectors.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => sourceRuns.id, { onDelete: 'set null' }),
  externalKey: varchar('external_key', { length: 255 }).notNull(),
  sourceUrl: varchar('source_url', { length: 1000 }).notNull(),
  documentType: varchar('document_type', { length: 100 }).notNull(),
  language: varchar('language', { length: 10 }).notNull().default('ro'),
  fileType: varchar('file_type', { length: 20 }).notNull(),
  title: text('title'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  storagePath: varchar('storage_path', { length: 500 }).notNull(),
  textContent: text('text_content'),
  structureJson: jsonb('structure_json'),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  connectorIdx: index('idx_funding_docs_raw_connector').on(table.connectorId),
  fetchedIdx: index('idx_funding_docs_raw_fetched').on(table.fetchedAt),
  uniqueVersion: uniqueIndex('idx_funding_docs_raw_unique_version').on(table.connectorId, table.externalKey, table.sha256),
}));

// ─── Funding Call Extractions ──────────────────────────────────
export const fundingCallExtractions = pgTable('funding_call_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => fundingDocumentsRaw.id, { onDelete: 'cascade' }),
  callExternalKey: varchar('call_external_key', { length: 255 }).notNull(),
  extractionVersion: integer('extraction_version').notNull().default(1),
  fieldName: varchar('field_name', { length: 100 }).notNull(),
  fieldValueJson: jsonb('field_value_json').notNull(),
  confidence: decimal('confidence', { precision: 5, scale: 4 }),
  evidenceSnippet: text('evidence_snippet'),
  evidencePage: integer('evidence_page'),
  evidenceLocator: varchar('evidence_locator', { length: 500 }),
  method: extractionMethodEnum('method').notNull().default('hybrid'),
  validated: boolean('validated').notNull().default(false),
  validationErrors: jsonb('validation_errors').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  callKeyIdx: index('idx_funding_call_extractions_call_key').on(table.callExternalKey),
  fieldIdx: index('idx_funding_call_extractions_field').on(table.fieldName),
  uniqueFieldVersion: uniqueIndex('idx_funding_call_extractions_unique').on(
    table.documentId,
    table.callExternalKey,
    table.fieldName,
    table.extractionVersion,
  ),
}));

// ─── Funding Call Versions ─────────────────────────────────────
export const fundingCallVersions = pgTable('funding_call_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  callExternalKey: varchar('call_external_key', { length: 255 }).notNull(),
  versionNo: integer('version_no').notNull(),
  changeType: varchar('change_type', { length: 50 }).notNull().default('updated'),
  changedFields: jsonb('changed_fields').notNull(),
  diffSummary: text('diff_summary'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  callKeyIdx: index('idx_funding_call_versions_call_key').on(table.callExternalKey),
  uniqueVersion: uniqueIndex('idx_funding_call_versions_unique').on(table.callExternalKey, table.versionNo),
}));

// ─── Funding Review Queue ──────────────────────────────────────
export const fundingReviewQueue = pgTable('funding_review_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  callExternalKey: varchar('call_external_key', { length: 255 }).notNull(),
  documentId: uuid('document_id').references(() => fundingDocumentsRaw.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  severity: reviewSeverityEnum('severity').notNull().default('medium'),
  status: reviewStatusEnum('status').notNull().default('pending'),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  resolutionNotes: text('resolution_notes'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('idx_funding_review_queue_status').on(table.status),
  severityIdx: index('idx_funding_review_queue_severity').on(table.severity),
  assigneeIdx: index('idx_funding_review_queue_assigned').on(table.assignedTo),
}));

// ─── Signature Workflows (QES) ──────────────────────────────────
export const signatureStatusEnum = pgEnum('signature_status', [
  'pending', 'prepared', 'signing', 'signed', 'rejected', 'expired', 'error',
]);

export const signatureWorkflows = pgTable('signature_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalWorkflowId: varchar('external_workflow_id', { length: 255 }),
  documentId: uuid('document_id').references(() => documents.id),
  projectId: uuid('project_id').references(() => projects.id),
  initiatedBy: uuid('initiated_by').notNull().references(() => users.id),
  documentTitle: varchar('document_title', { length: 500 }).notNull(),
  documentHash: varchar('document_hash', { length: 128 }),
  status: signatureStatusEnum('status').default('pending'),
  signers: jsonb('signers').default([]),
  auditTrail: jsonb('audit_trail').default([]),
  provider: varchar('provider', { length: 50 }).default('certsign'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  statusIdx: index('idx_sig_workflows_status').on(table.status),
  projectIdx: index('idx_sig_workflows_project').on(table.projectId),
  initiatorIdx: index('idx_sig_workflows_initiator').on(table.initiatedBy),
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
  entryHash: varchar('entry_hash', { length: 64 }),
  previousHash: varchar('previous_hash', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdx: index('idx_audit_user').on(table.userId),
  resourceIdx: index('idx_audit_resource').on(table.resourceType, table.resourceId),
  createdIdx: index('idx_audit_created').on(table.createdAt),
  hashChainIdx: index('idx_audit_hash_chain').on(table.createdAt, table.entryHash),
}));

// ─── Feature Flags ──────────────────────────────────────────────
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 100 }).unique().notNull(),
  description: text('description'),
  enabled: boolean('enabled').notNull().default(false),
  targeting: jsonb('targeting').default({}), // { tiers?: string[], userIds?: string[], percentage?: number }
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── AI Reviews (EU AI Act Art. 14 — Human Oversight) ──────────
export const aiReviewStatusEnum = pgEnum('ai_review_status', [
  'pending_review', 'approved', 'rejected',
]);

export const aiReviews = pgTable('ai_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  requestedBy: uuid('requested_by').notNull().references(() => users.id),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  feature: varchar('feature', { length: 100 }).notNull(), // e.g. 'predict-success', 'match-grants'
  riskLevel: varchar('risk_level', { length: 20 }).notNull(), // 'high', 'limited'
  inputSummary: text('input_summary'), // Brief description of what was analyzed
  resultData: jsonb('result_data').notNull(), // The AI output stored for review
  resultMetadata: jsonb('result_metadata').default({}), // AI Act metadata (confidence, disclaimers)
  status: aiReviewStatusEnum('status').default('pending_review'),
  reviewNote: text('review_note'), // Reviewer's comment
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
}, (table) => ({
  orgIdx: index('idx_ai_reviews_org').on(table.orgId),
  statusIdx: index('idx_ai_reviews_status').on(table.status),
  requestedByIdx: index('idx_ai_reviews_requested_by').on(table.requestedBy),
}));

// ─── Work Packages ──────────────────────────────────────────────
export const workPackages = pgTable('work_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  budgetAllocated: decimal('budget_allocated', { precision: 12, scale: 2 }),
  budgetSpent: decimal('budget_spent', { precision: 12, scale: 2 }).default('0'),
  status: workPackageStatusEnum('status').default('planned'),
  leadPartnerId: uuid('lead_partner_id').references(() => organizations.id),
  dependencies: jsonb('dependencies').default([]),
  milestones: jsonb('milestones').default([]),
  deliverables: jsonb('deliverables').default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  projectIdx: index('idx_wp_project').on(table.projectId),
  statusIdx: index('idx_wp_status').on(table.status),
}));

// ─── Project Timelines ──────────────────────────────────────────
export const projectTimelines = pgTable('project_timelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workPackageId: uuid('work_package_id').references(() => workPackages.id, { onDelete: 'cascade' }),
  taskName: varchar('task_name', { length: 255 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  dependencies: jsonb('dependencies').default([]),
  progressPercentage: integer('progress_percentage').default(0),
  assignedTo: uuid('assigned_to').references(() => users.id),
  riskLevel: riskLevelEnum('risk_level').default('low'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  projectIdx: index('idx_timeline_project').on(table.projectId),
  wpIdx: index('idx_timeline_wp').on(table.workPackageId),
}));

// ─── Risk Assessments ───────────────────────────────────────────
export const riskAssessments = pgTable('risk_assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  riskType: varchar('risk_type', { length: 100 }).notNull(),
  description: text('description'),
  probability: integer('probability'),
  impact: integer('impact'),
  mitigationStrategy: text('mitigation_strategy'),
  status: varchar('status', { length: 50 }).default('identified'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  projectIdx: index('idx_risk_project').on(table.projectId),
}));

// ─── Compliance Checks ──────────────────────────────────────────
export const complianceChecks = pgTable('compliance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  criterionName: varchar('criterion_name', { length: 255 }).notNull(),
  requirementText: text('requirement_text'),
  complianceScore: integer('compliance_score'),
  status: varchar('status', { length: 50 }).default('pending'),
  evidenceDocuments: jsonb('evidence_documents').default([]),
  assessorNotes: text('assessor_notes'),
  assessedAt: timestamp('assessed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  projectIdx: index('idx_compliance_check_project').on(table.projectId),
}));

// ─── Orchestrator Redesign Tables ────────────────────────────────
export const workflowSessions = pgTable('workflow_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  projectId: uuid('project_id').references(() => projects.id),
  currentStep: integer('current_step').notNull().default(1),
  context: jsonb('context').notNull().default(sql`'{}'`),
  status: workflowStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_workflow_sessions_user').on(table.userId),
  statusIdx: index('idx_workflow_sessions_status').on(table.status),
}))

export const workflowMessages = pgTable('workflow_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => workflowSessions.id, { onDelete: 'cascade' }),
  eventId: integer('event_id'),
  role: workflowMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  step: integer('step'),
  eventType: varchar('event_type', { length: 50 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionIdIdx: index('idx_workflow_messages_session').on(table.sessionId),
  createdAtIdx: index('idx_workflow_messages_created').on(table.createdAt),
}))

// ─── Section Versions (Phase 1: trust infrastructure) ───────────
export const sectionVersions = pgTable('section_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => workflowSessions.id, { onDelete: 'cascade' }),
  sectionId: text('section_id').notNull(),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  title: text('title').notNull(),
  metadata: jsonb('metadata').notNull().default(sql`'{}'`),
  reason: text('reason').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
}, (table) => ({
  sessionSectionIdx: index('idx_section_versions_session_section').on(table.sessionId, table.sectionId),
  createdAtIdx: index('idx_section_versions_created_at').on(table.createdAt),
  sessionSectionVersionUnique: unique('uq_section_versions_session_section_version').on(table.sessionId, table.sectionId, table.version),
}))

export const callKnowledgeStatusEnum = pgEnum('call_knowledge_status', [
  'provisional', 'primed', 'verified',
])

export const callKnowledge = pgTable('call_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  callId: text('call_id').notNull(),
  canonicalCallId: uuid('canonical_call_id').references(() => callsForProposals.id),
  program: text('program').notNull(),
  callTitle: text('call_title').notNull(),
  normalized: jsonb('normalized').notNull().default({}),
  status: callKnowledgeStatusEnum('status').notNull().default('provisional'),
  extractedFrom: varchar('extracted_from', { length: 20 }).notNull().default('qdrant_obsidian'),
  structureConfidence: real('structure_confidence').notNull().default(0),
  freshnessConfidence: real('freshness_confidence').notNull().default(0),
  sourceDocs: jsonb('source_docs').notNull().default([]),
  fieldProvenance: jsonb('field_provenance').default({}),
  contentExtractedAt: timestamp('content_extracted_at', { withTimezone: true }).notNull().defaultNow(),
  freshnessCheckedAt: timestamp('freshness_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqCallId: uniqueIndex('idx_call_knowledge_call_id').on(table.callId),
  idxCanonical: index('idx_call_knowledge_canonical').on(table.canonicalCallId),
  idxProgram: index('idx_call_knowledge_program').on(table.program),
  idxContentExtracted: index('idx_call_knowledge_content_extracted').on(table.contentExtractedAt),
  idxFreshnessChecked: index('idx_call_knowledge_freshness_checked').on(table.freshnessCheckedAt),
  idxStatus: index('idx_call_knowledge_status').on(table.status),
}))

// ── Agent V3 Tables ─────────────────────────────────────────────

export const agentSessionStatusEnum = pgEnum('agent_session_status', [
  'active', 'paused', 'completed', 'abandoned', 'error',
])

export const agentPhaseEnum = pgEnum('agent_phase', [
  'discovery', 'research', 'structuring', 'drafting', 'review',
])

export const runtimeModeEnum = pgEnum('runtime_mode', ['v3', 'managed'])

export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  status: agentSessionStatusEnum('status').notNull().default('active'),
  locale: varchar('locale', { length: 5 }).notNull().default('ro'),
  selectedCallId: varchar('selected_call_id', { length: 255 }),
  currentPhase: agentPhaseEnum('current_phase').notNull().default('discovery'),
  blueprint: jsonb('blueprint'),
  eligibility: jsonb('eligibility'),
  outline: jsonb('outline'),
  warnings: jsonb('warnings').default([]),
  planningArtifact: jsonb('planning_artifact'),
  outlineFrozen: boolean('outline_frozen').notNull().default(false),
  messageSummary: text('message_summary'),
  stateVersion: integer('state_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxUserStatus: index('idx_agent_sessions_user_status').on(table.userId, table.status, table.updatedAt),
  idxCallId: index('idx_agent_sessions_call').on(table.selectedCallId),
}))

export const agentTurns = pgTable('agent_turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  runtimeMode: runtimeModeEnum('runtime_mode').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  // Per-turn cost telemetry (nullable; populated by the managed runtime after
  // the stream completes). cost_usd_micros is dollars × 1_000_000 to avoid
  // float drift in SUM queries. See migration 0030.
  model: varchar('model', { length: 100 }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheReadInputTokens: integer('cache_read_input_tokens'),
  cacheCreationInputTokens: integer('cache_creation_input_tokens'),
  costUsdMicros: bigint('cost_usd_micros', { mode: 'number' }),
}, (table) => ({
  sessionRequestUnique: unique('agent_turns_session_request_unique').on(table.sessionId, table.requestId),
  idxSessionStarted: index('idx_agent_turns_session_started').on(table.sessionId, desc(table.startedAt)),
}));

export const agentSectionStatusEnum = pgEnum('agent_section_status', [
  'pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed', 'rejected',
])

export const agentSections = pgTable('agent_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  sectionKey: varchar('section_key', { length: 100 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  documentOrder: integer('document_order').notNull(),
  generationOrder: integer('generation_order').notNull(),
  status: agentSectionStatusEnum('status').notNull().default('pending'),
  content: text('content'),
  acceptedContent: text('accepted_content'),
  modelUsed: varchar('model_used', { length: 100 }),
  retryCount: integer('retry_count').notNull().default(0),
  sourcesUsed: jsonb('sources_used'),
  promptVersion: varchar('prompt_version', { length: 50 }),
  latencyMs: integer('latency_ms'),
  tokenUsage: jsonb('token_usage'),
  errorClass: varchar('error_class', { length: 100 }),
  rejectionReason: text('rejection_reason'),  // NEW — Phase 3a
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqSessionSection: uniqueIndex('uniq_agent_section_session_key').on(table.sessionId, table.sectionKey),
  idxSessionOrder: index('idx_agent_sections_order').on(table.sessionId, table.documentOrder),
  idxSessionStatus: index('idx_agent_sections_status').on(table.sessionId, table.status),
}))

export const agentSectionVersionKindEnum = pgEnum('agent_section_version_kind', [
  'draft', 'accepted', 'regenerated', 'system_rewrite', 'rollback',
])

export const agentSectionVersions = pgTable('agent_section_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sectionId: uuid('section_id').notNull().references(() => agentSections.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  kind: agentSectionVersionKindEnum('kind').notNull(),
  content: text('content').notNull(),
  modelUsed: varchar('model_used', { length: 100 }),
  sourcesUsed: jsonb('sources_used'),
  rolledBackFromVersion: integer('rolled_back_from_version'),  // Phase 3a; populated only when kind='rollback'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqSectionVersion: uniqueIndex('uniq_agent_section_version_number').on(table.sectionId, table.versionNumber),
}))

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 15 }).notNull(),
  messageType: varchar('message_type', { length: 20 }).notNull(),
  content: jsonb('content').notNull(),
  toolName: varchar('tool_name', { length: 100 }),
  toolCallId: varchar('tool_call_id', { length: 100 }),
  sequenceNumber: integer('sequence_number').notNull(),
  compactedAt: timestamp('compacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Phase 2 managed-runtime observability columns
  runtimeMode: runtimeModeEnum('runtime_mode').notNull().default('v3'),
  provider: varchar('provider', { length: 20 }),
  model: varchar('model', { length: 50 }),
  turnId: uuid('turn_id').references(() => agentTurns.id, { onDelete: 'set null' }),
}, (table) => ({
  idxSessionSequence: uniqueIndex('idx_agent_messages_session_sequence').on(table.sessionId, table.sequenceNumber),
  idxSessionCompacted: index('idx_agent_messages_compacted').on(table.sessionId, table.compactedAt),
  idxRuntime: index('idx_agent_messages_runtime').on(table.runtimeMode, table.createdAt),
}))

export const applicationAgentSessions = pgTable('application_agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().unique()
    .references(() => agentSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),

  runtimeMode: runtimeModeEnum('runtime_mode').notNull().default('managed'),
  createdWithFlag: boolean('created_with_flag').notNull().default(false),

  status: agentSessionStatusEnum('status').notNull().default('active'),

  degradedAt: timestamp('degraded_at', { withTimezone: true }),
  degradedReason: text('degraded_reason'),

  lastTurnAt: timestamp('last_turn_at', { withTimezone: true }),
  lastTurnModel: varchar('last_turn_model', { length: 50 }),
  lastTurnToolCount: integer('last_turn_tool_count').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => ({
  idxUserStatus: index('idx_app_agent_sessions_user_status')
    .on(table.userId, table.status, table.updatedAt),
}))

export const agentCheckpoints = pgTable('agent_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  checkpointType: varchar('checkpoint_type', { length: 30 }).notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxSessionCreated: index('idx_agent_checkpoints_created').on(table.sessionId, table.createdAt),
}))

// ── Knowledge Layer Tables ─────────────────────────────────────

export const sessionKnowledgeKindEnum = pgEnum('session_knowledge_kind', [
  'brief', 'evidence_map', 'risks', 'budget_rationale',
  'decision_log', 'section_pattern',
])

export const sessionKnowledge = pgTable('session_knowledge', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  kind: sessionKnowledgeKindEnum('kind').notNull(),
  slug: varchar('slug', { length: 200 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  contentMd: text('content_md').notNull(),
  frontmatter: jsonb('frontmatter').notNull().default({}),
  sourceRefs: jsonb('source_refs').notNull().default([]),
  derivedFromSectionId: uuid('derived_from_section_id').references(() => agentSections.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxSessionKind: index('idx_session_knowledge_session_kind').on(table.sessionId, table.kind),
  idxProjectKind: index('idx_session_knowledge_project_kind').on(table.projectId, table.kind),
  uniqSessionSlug: uniqueIndex('uniq_session_knowledge_session_slug').on(table.sessionId, table.slug),
}))

export const proposalPatterns = pgTable('proposal_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  program: varchar('program', { length: 50 }).notNull(),
  sectionType: varchar('section_type', { length: 100 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  contentMd: text('content_md').notNull(),
  frontmatter: jsonb('frontmatter').notNull().default({}),
  derivedFromSections: jsonb('derived_from_sections').notNull().default([]),
  timesUsed: integer('times_used').notNull().default(0),
  timesAccepted: integer('times_accepted').notNull().default(0),
  avgRegenCount: real('avg_regen_count').notNull().default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxProgramSection: index('idx_proposal_patterns_program_section').on(table.program, table.sectionType),
  idxTimesUsed: index('idx_proposal_patterns_used').on(table.timesUsed),
}))

export const discoveredCalls = pgTable('discovered_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceUrl: text('source_url').notNull(),
  sourceDomain: text('source_domain').notNull(),
  title: text('title').notNull(),
  program: text('program'),
  summary: text('summary'),
  rawContent: text('raw_content'),
  contentHash: text('content_hash').notNull().unique(),
  discoveredAt: timestamp('discovered_at').defaultNow().notNull(),
  discoveryMethod: discoveryMethodEnum('discovery_method').notNull(),
  discoverySource: text('discovery_source'),
  status: discoveryStatusEnum('status').notNull().default('pending_review'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  callId: uuid('call_id').references(() => callsForProposals.id),
}, (table) => ({
  statusIdx: index('idx_discovered_calls_status').on(table.status),
}))

export const programAlerts = pgTable('program_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  program: text('program').notNull(),
  urgency: alertUrgencyEnum('urgency').notNull().default('daily'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_program_alerts_user').on(table.userId),
}))

export const projectDocuments = pgTable('project_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  version: integer('version').notNull().default(1),
  sections: jsonb('sections').notNull(),
  actionPlan: jsonb('action_plan'),
  metadata: jsonb('metadata'),
  status: projectDocStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  projectIdIdx: index('idx_project_documents_project').on(table.projectId),
}))

export const projectFiles = pgTable('project_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath: text('storage_path').notNull(),
  category: fileCategory('category').notNull(),
  description: text('description'),
  extractedText: text('extracted_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  projectIdIdx: index('idx_project_files_project').on(table.projectId),
}))

export const teamMembers = pgTable('team_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  memberId: uuid('member_id').notNull().references(() => users.id),
  invitedAt: timestamp('invited_at').defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at'),
}, (table) => ({
  ownerIdIdx: index('idx_team_members_owner').on(table.ownerId),
  memberIdIdx: index('idx_team_members_member').on(table.memberId),
  uniqueOwnerMember: unique('uq_team_owner_member').on(table.ownerId, table.memberId),
}))

// ─── User Preferences ───────────────────────────────────────────
export const aiModelPreferenceEnum = pgEnum('ai_model_preference', [
  'auto',
  'claude-sonnet', 'claude-haiku',
  'gpt-4o', 'gpt-4o-mini', 'gpt-4o-nano',
  'gemini-pro', 'gemini-flash', 'nano-banana',
  'perplexity',
])

export const responseStyleEnum = pgEnum('response_style', [
  'concise', 'detailed', 'technical'
])

export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id).unique(),
  defaultModel: aiModelPreferenceEnum('default_model').notNull().default('auto'),
  responseStyle: responseStyleEnum('response_style').notNull().default('detailed'),
  autoApprove: boolean('auto_approve').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ─── Relations ──────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  orgMemberships: many(orgMembers),
  projects: many(projects),
  notifications: many(notifications),
  consentRecords: many(consentRecords),
  emailVerificationTokens: many(emailVerificationTokens),
  authAccounts: many(authAccounts),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, { fields: [authAccounts.userId], references: [users.id] }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
  projects: many(projects),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
  organization: one(organizations, { fields: [orgMembers.orgId], references: [organizations.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, { fields: [projects.orgId], references: [organizations.id] }),
  creator: one(users, { fields: [projects.createdBy], references: [users.id] }),
  call: one(callsForProposals, { fields: [projects.callId], references: [callsForProposals.id] }),
  versions: many(projectVersions),
  comments: many(projectComments),
  documents: many(documents),
  workPackages: many(workPackages),
  timelines: many(projectTimelines),
  riskAssessments: many(riskAssessments),
  complianceChecks: many(complianceChecks),
}));

export const workPackagesRelations = relations(workPackages, ({ one, many }) => ({
  project: one(projects, { fields: [workPackages.projectId], references: [projects.id] }),
  leadPartner: one(organizations, { fields: [workPackages.leadPartnerId], references: [organizations.id] }),
  timelineItems: many(projectTimelines),
}));

export const projectTimelinesRelations = relations(projectTimelines, ({ one }) => ({
  project: one(projects, { fields: [projectTimelines.projectId], references: [projects.id] }),
  workPackage: one(workPackages, { fields: [projectTimelines.workPackageId], references: [workPackages.id] }),
  assignee: one(users, { fields: [projectTimelines.assignedTo], references: [users.id] }),
}));

export const riskAssessmentsRelations = relations(riskAssessments, ({ one }) => ({
  project: one(projects, { fields: [riskAssessments.projectId], references: [projects.id] }),
}));

export const complianceChecksRelations = relations(complianceChecks, ({ one }) => ({
  project: one(projects, { fields: [complianceChecks.projectId], references: [projects.id] }),
}));

export const projectVersionsRelations = relations(projectVersions, ({ one }) => ({
  project: one(projects, { fields: [projectVersions.projectId], references: [projects.id] }),
}));

export const projectCommentsRelations = relations(projectComments, ({ one }) => ({
  project: one(projects, { fields: [projectComments.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectComments.userId], references: [users.id] }),
}));

export const callsForProposalsRelations = relations(callsForProposals, ({ one }) => ({
  program: one(fundingPrograms, { fields: [callsForProposals.programId], references: [fundingPrograms.id] }),
  sourceConnector: one(sourceConnectors, { fields: [callsForProposals.sourceConnectorId], references: [sourceConnectors.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  organization: one(organizations, { fields: [documents.orgId], references: [organizations.id] }),
  project: one(projects, { fields: [documents.projectId], references: [projects.id] }),
  uploader: one(users, { fields: [documents.uploadedBy], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const consentRecordsRelations = relations(consentRecords, ({ one }) => ({
  user: one(users, { fields: [consentRecords.userId], references: [users.id] }),
}));

export const emailVerificationTokensRelations = relations(emailVerificationTokens, ({ one }) => ({
  user: one(users, { fields: [emailVerificationTokens.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const aiReviewsRelations = relations(aiReviews, ({ one }) => ({
  organization: one(organizations, { fields: [aiReviews.orgId], references: [organizations.id] }),
  requestedByUser: one(users, { fields: [aiReviews.requestedBy], references: [users.id] }),
}));

export const sourceConnectorsRelations = relations(sourceConnectors, ({ many }) => ({
  runs: many(sourceRuns),
  documents: many(fundingDocumentsRaw),
}));

export const sourceRunsRelations = relations(sourceRuns, ({ one, many }) => ({
  connector: one(sourceConnectors, { fields: [sourceRuns.connectorId], references: [sourceConnectors.id] }),
  documents: many(fundingDocumentsRaw),
}));

export const fundingDocumentsRawRelations = relations(fundingDocumentsRaw, ({ one, many }) => ({
  connector: one(sourceConnectors, { fields: [fundingDocumentsRaw.connectorId], references: [sourceConnectors.id] }),
  run: one(sourceRuns, { fields: [fundingDocumentsRaw.runId], references: [sourceRuns.id] }),
  extractions: many(fundingCallExtractions),
  reviewQueueItems: many(fundingReviewQueue),
}));

export const fundingCallExtractionsRelations = relations(fundingCallExtractions, ({ one }) => ({
  document: one(fundingDocumentsRaw, { fields: [fundingCallExtractions.documentId], references: [fundingDocumentsRaw.id] }),
}));

export const fundingCallVersionsRelations = relations(fundingCallVersions, ({ one }) => ({
  creator: one(users, { fields: [fundingCallVersions.createdBy], references: [users.id] }),
}));

export const fundingReviewQueueRelations = relations(fundingReviewQueue, ({ one }) => ({
  document: one(fundingDocumentsRaw, { fields: [fundingReviewQueue.documentId], references: [fundingDocumentsRaw.id] }),
  assignee: one(users, { fields: [fundingReviewQueue.assignedTo], references: [users.id] }),
  creator: one(users, { fields: [fundingReviewQueue.createdBy], references: [users.id] }),
}));
