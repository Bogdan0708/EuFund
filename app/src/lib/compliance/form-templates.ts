import type { SubmissionDocument } from '@/lib/ai/agent/types'

export interface FormTemplate {
  templateId: string
  version: string
  title: string
  category: SubmissionDocument['category']
  scope: 'general' | 'call_specific'
  availability: 'generated' | 'needs_fill'
  instructions: string
  bodyTemplate: string
  variables: string[]
  matchesAnnex?: RegExp
}

export const FORM_TEMPLATES: FormTemplate[] = [
  // ─── General EU Requirements ──────────────────────────────────
  {
    templateId: 'tpl-declaratie-gdpr',
    version: '2024-Q1',
    title: 'Declarație privind prelucrarea datelor cu caracter personal',
    category: 'declaration',
    scope: 'general',
    availability: 'needs_fill',
    instructions: 'Completați datele organizației, semnați și ștampilați.',
    bodyTemplate: `DECLARAȚIE
privind prelucrarea datelor cu caracter personal
conform Regulamentului (UE) 2016/679 (GDPR) și Legii nr. 190/2018

Subsemnatul/a {{representativeName}}, în calitate de {{representativeRole}} al {{orgName}}, cu sediul în {{orgAddress}}, CUI {{cui}}, în calitate de solicitant în cadrul proiectului "{{projectTitle}}", finanțat prin programul {{programName}},

DECLAR PE PROPRIA RĂSPUNDERE că:

1. Am luat cunoștință de obligațiile care îmi revin în calitate de operator de date cu caracter personal, conform Regulamentului (UE) 2016/679 și Legii nr. 190/2018.

2. Mă angajez să prelucreze datele cu caracter personal colectate în cadrul proiectului exclusiv în scopul implementării proiectului și în conformitate cu legislația aplicabilă.

3. Am implementat măsuri tehnice și organizatorice adecvate pentru protecția datelor cu caracter personal.

4. Voi informa persoanele vizate cu privire la prelucrarea datelor lor cu caracter personal, conform art. 13-14 din GDPR.

Data: {{date}}

{{orgName}}
Reprezentant legal: {{representativeName}}
Semnătura: [___]
Ștampila: [___]`,
    variables: ['representativeName', 'representativeRole', 'orgName', 'orgAddress', 'cui', 'projectTitle', 'programName', 'date'],
  },
  {
    templateId: 'tpl-declaratie-anti-frauda',
    version: '2024-Q1',
    title: 'Declarație anti-fraudă',
    category: 'declaration',
    scope: 'general',
    availability: 'needs_fill',
    instructions: 'Completați datele organizației, semnați și ștampilați.',
    bodyTemplate: `DECLARAȚIE
privind evitarea fraudei, corupției și conflictului de interese

Subsemnatul/a {{representativeName}}, în calitate de {{representativeRole}} al {{orgName}}, CUI {{cui}},

DECLAR PE PROPRIA RĂSPUNDERE că:

1. Nu mă aflu în niciuna din situațiile de excludere prevăzute de legislația europeană și națională aplicabilă.

2. Mă angajez să respect principiile de bună gestiune financiară, transparență și prevenire a fraudei în implementarea proiectului "{{projectTitle}}".

3. Voi informa imediat Autoritatea de Management/Organismul Intermediar despre orice situație care ar putea constitui fraudă, corupție sau conflict de interese.

Data: {{date}}

{{orgName}}
Reprezentant legal: {{representativeName}}
Semnătura: [___]
Ștampila: [___]`,
    variables: ['representativeName', 'representativeRole', 'orgName', 'cui', 'projectTitle', 'date'],
  },
  {
    templateId: 'tpl-obligatii-publicitate',
    version: '2024-Q1',
    title: 'Declarație privind obligațiile de publicitate',
    category: 'declaration',
    scope: 'general',
    availability: 'needs_fill',
    instructions: 'Completați datele proiectului, semnați și ștampilați.',
    bodyTemplate: `DECLARAȚIE
privind respectarea obligațiilor de informare și publicitate
conform Regulamentului (UE) 2021/1060, Anexa IX

Subsemnatul/a {{representativeName}}, în calitate de {{representativeRole}} al {{orgName}}, CUI {{cui}},

DECLAR PE PROPRIA RĂSPUNDERE că mă angajez:

1. Să respect obligațiile de informare și publicitate prevăzute de Regulamentul (UE) 2021/1060, Anexa IX, pe toată durata implementării proiectului "{{projectTitle}}".

2. Să afișez emblema Uniunii Europene și referința la fondul sau fondurile care sprijină operațiunea pe toate materialele de comunicare și vizibilitate.

3. Să instalez un panou sau un afiș durabil la locul de implementare a proiectului, vizibil publicului.

4. Să menționez sprijinul primit din fonduri europene pe site-ul web al organizației (dacă există).

Data: {{date}}

{{orgName}}
Reprezentant legal: {{representativeName}}
Semnătura: [___]
Ștampila: [___]`,
    variables: ['representativeName', 'representativeRole', 'orgName', 'cui', 'projectTitle', 'date'],
  },
  {
    templateId: 'tpl-declaratie-beneficiar-real',
    version: '2024-Q1',
    title: 'Declarație privind beneficiarul real',
    category: 'declaration',
    scope: 'general',
    availability: 'needs_fill',
    instructions: 'Completați datele beneficiarului real, semnați și ștampilați.',
    bodyTemplate: `DECLARAȚIE
privind identificarea beneficiarului real
conform Legii nr. 129/2019

Subsemnatul/a {{representativeName}}, în calitate de {{representativeRole}} al {{orgName}}, cu sediul în {{orgAddress}}, CUI {{cui}},

DECLAR PE PROPRIA RĂSPUNDERE că beneficiarul/beneficiarii real/reali ai organizației, conform Legii nr. 129/2019, este/sunt:

1. Nume: [___]  CNP: [___]  Cetățenie: [___]  Calitate: [___]

Declar că informațiile furnizate sunt complete și corecte.

Data: {{date}}

{{orgName}}
Reprezentant legal: {{representativeName}}
Semnătura: [___]
Ștampila: [___]`,
    variables: ['representativeName', 'representativeRole', 'orgName', 'orgAddress', 'cui', 'date'],
  },

  // ─── Common Call-Specific Templates ────────────────────────────
  {
    templateId: 'tpl-declaratie-minimis',
    version: '2024-Q1',
    title: 'Declarație privind ajutoarele de minimis',
    category: 'declaration',
    scope: 'call_specific',
    availability: 'needs_fill',
    instructions: 'Completați lista ajutoarelor de minimis primite în ultimii 3 ani fiscali, semnați și ștampilați.',
    bodyTemplate: `DECLARAȚIE
privind ajutoarele de stat / ajutoarele de minimis
conform Regulamentului (UE) nr. 2023/2831

Subsemnatul/a {{representativeName}}, în calitate de {{representativeRole}} al {{orgName}}, CUI {{cui}},

DECLAR PE PROPRIA RĂSPUNDERE că:

1. În ultimii 3 ani fiscali (anul fiscal curent și cei 2 ani fiscali precedenți), {{orgName}} a beneficiat de următoarele ajutoare de minimis:

| Nr. | Furnizor ajutor | Baza legală | Nr. contract | Data | Valoare (EUR) |
|-----|----------------|-------------|--------------|------|---------------|
| 1.  | [___]          | [___]       | [___]        | [___]| [___]         |

SAU

Nu a beneficiat de ajutoare de minimis în perioada menționată: [___]

2. Valoarea totală a ajutoarelor de minimis primite în perioada menționată nu depășește plafonul de 300.000 EUR (conform Regulamentului (UE) nr. 2023/2831).

Data: {{date}}

{{orgName}}
Reprezentant legal: {{representativeName}}
Semnătura: [___]
Ștampila: [___]`,
    variables: ['representativeName', 'representativeRole', 'orgName', 'cui', 'date'],
    matchesAnnex: /minimis|de\s+minimis|ajutor.*stat/i,
  },
  {
    templateId: 'tpl-declaratie-ani',
    version: '2024-Q1',
    title: 'Declarație privind conflictul de interese (ANI)',
    category: 'declaration',
    scope: 'call_specific',
    availability: 'needs_fill',
    instructions: 'Completați datele, semnați și ștampilați. Verificați compatibilitatea cu situațiile prevăzute de Legea nr. 176/2010.',
    bodyTemplate: `DECLARAȚIE
privind evitarea conflictului de interese
conform Legii nr. 176/2010

Subsemnatul/a {{representativeName}}, în calitate de {{representativeRole}} al {{orgName}}, CUI {{cui}},

DECLAR PE PROPRIA RĂSPUNDERE că:

1. Nu mă aflu în situație de conflict de interese, așa cum este definit de Legea nr. 176/2010 privind integritatea în exercitarea funcțiilor și demnităților publice.

2. Nu am calitatea de soț/soție, rudă sau afin până la gradul al doilea inclusiv cu persoane care dețin funcții de decizie în cadrul Autorității de Management sau Organismului Intermediar.

3. Mă angajez să informez imediat Autoritatea de Management/Organismul Intermediar în cazul apariției oricărei situații de conflict de interese pe parcursul implementării proiectului "{{projectTitle}}".

Data: {{date}}

{{orgName}}
Reprezentant legal: {{representativeName}}
Semnătura: [___]
Ștampila: [___]`,
    variables: ['representativeName', 'representativeRole', 'orgName', 'cui', 'projectTitle', 'date'],
    matchesAnnex: /ANI|conflict.*interes|integritate/i,
  },
  {
    templateId: 'tpl-declaratie-eligibilitate',
    version: '2024-Q1',
    title: 'Declarație de eligibilitate',
    category: 'declaration',
    scope: 'call_specific',
    availability: 'needs_fill',
    instructions: 'Verificați fiecare criteriu, completați datele organizației, semnați și ștampilați.',
    bodyTemplate: `DECLARAȚIE
privind eligibilitatea solicitantului

Subsemnatul/a {{representativeName}}, în calitate de {{representativeRole}} al {{orgName}}, cu sediul în {{orgAddress}}, CUI {{cui}},

DECLAR PE PROPRIA RĂSPUNDERE că:

1. {{orgName}} este persoană juridică legal constituită în România.
2. Nu mă aflu în stare de insolvență, faliment, lichidare sau dizolvare.
3. Mi-am îndeplinit obligațiile de plată a impozitelor, taxelor și contribuțiilor sociale.
4. Nu am fost condamnat printr-o hotărâre judecătorească definitivă pentru fraudă, corupție, participare la o organizație criminală sau orice altă activitate ilegală.
5. Nu am comis o greșeală profesională gravă.
6. Nu fac obiectul unui ordin de recuperare în urma unei decizii a Comisiei Europene.

Data: {{date}}

{{orgName}}
Reprezentant legal: {{representativeName}}
Semnătura: [___]
Ștampila: [___]`,
    variables: ['representativeName', 'representativeRole', 'orgName', 'orgAddress', 'cui', 'date'],
    matchesAnnex: /eligibilitate|admisibilitate|criteri.*eligib/i,
  },
]
