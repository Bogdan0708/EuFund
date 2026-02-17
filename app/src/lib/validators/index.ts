import { z } from 'zod';
import { validateCUI, validateCAEN, validatePhoneRO, normalizeDiacritics } from '@/lib/utils/romanian';

// ─── Auth Validators ─────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email('Adresa de email nu este validă.'),
  password: z.string().min(8, 'Parola trebuie să aibă cel puțin 8 caractere.'),
  confirmPassword: z.string(),
  fullName: z.string().min(2, 'Numele trebuie să aibă cel puțin 2 caractere.').transform(normalizeDiacritics),
  phone: z.string().optional().refine(
    (val) => !val || validatePhoneRO(val),
    'Numărul de telefon nu este valid.',
  ),
  dateOfBirth: z.string().refine((val) => {
    const dob = new Date(val);
    const now = new Date();
    const age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    const adjustedAge = monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate()) ? age - 1 : age;
    return adjustedAge >= 16;
  }, 'Trebuie să aveți cel puțin 16 ani (conform Legii 190/2018).'),
  ageConfirmed: z.literal(true, 'Trebuie să confirmați că aveți cel puțin 16 ani.'),
  privacyConsent: z.literal(true, 'Trebuie să acceptați Politica de confidențialitate.'),
  termsConsent: z.literal(true, 'Trebuie să acceptați Termenii și condițiile.'),
  gdprConsent: z.literal(true, 'Trebuie să fiți de acord cu prelucrarea datelor personale.'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Parolele nu coincid.',
  path: ['confirmPassword'],
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Organization Validators ─────────────────────────────────────

export const organizationSchema = z.object({
  name: z.string().min(2).max(500).transform(normalizeDiacritics),
  cui: z.string().refine(validateCUI, 'CUI-ul introdus nu este valid.'),
  regCom: z.string().optional(),
  orgType: z.enum(['srl', 'sa', 'pfa', 'ong', 'uat', 'institutie_publica', 'altul']),
  orgSize: z.enum(['micro', 'mica', 'medie', 'mare']).optional(),
  caenPrimary: z.string().refine(validateCAEN, 'Codul CAEN nu este valid.').optional(),
  caenSecondary: z.array(z.string().refine(validateCAEN, 'Codul CAEN nu este valid.')).optional(),
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    county: z.string().optional(),
    postalCode: z.string().optional(),
  }).optional(),
  nutsRegion: z.string().regex(/^RO\d{2}$/).optional(),
  legalRepName: z.string().optional(),
  legalRepRole: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().refine((v) => !v || validatePhoneRO(v)).optional(),
  website: z.string().url().optional(),
});

// ─── Project Validators ──────────────────────────────────────────

export const createProjectSchema = z.object({
  title: z.string().min(10, 'Titlul trebuie să aibă cel puțin 10 caractere.')
    .max(1000).transform(normalizeDiacritics),
  acronym: z.string().max(50).optional(),
  callId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationMonths: z.number().min(1).max(120).optional(),
});

export const updateProjectSectionSchema = z.object({
  section: z.enum([
    'summary', 'context', 'objectives', 'methodology',
    'budget', 'indicators', 'sustainability', 'partnership', 'risks',
  ]),
  content: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OrganizationInput = z.infer<typeof organizationSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
