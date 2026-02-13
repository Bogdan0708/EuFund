# PRD – Platformă de Finanțări Europene pentru Organizații din România

## 1. Viziune

O platformă AI care ghidează organizațiile românești prin întregul ciclu de pregătire a cererilor de finanțare europeană — de la identificarea grantului potrivit până la generarea propunerii conforme.

**Nume produs:** FondEU (placeholder)

---

## 2. Personas

### P1 – Antreprenor IMM (Ana, 38 ani)
- Conduce un IMM cu 15 angajați în Cluj-Napoca (producție mobilă)
- A mai aplicat o dată la fonduri EU, fără succes
- Caută: ghidare pas-cu-pas, verificare automată a eligibilității
- Frustrare: limbajul birocratic, termenele neclare
- Limbă preferată: Română

### P2 – Manager Proiecte ONG (Mihai, 45 ani)
- ONG mediu (educație rurală), experiență medie cu proiecte EU
- Caută: matching rapid cu apeluri relevante, generare de buget, timeline
- Frustrare: schimbări legislative frecvente, cerințe diferite per program
- Limbă preferată: Română, citește și engleză

### P3 – Funcționar Public – UAT (Elena, 52 ani)
- Primărie din mediul rural, 12.000 locuitori
- Caută: conformitate cu legislația achizițiilor publice, modele de proiecte similare
- Frustrare: lipsa personalului calificat, documentație masivă
- Limbă preferată: Exclusiv română

### P4 – Consultant fonduri europene (Radu, 33 ani)
- Firmă de consultanță, gestionează 10-20 proiecte simultan
- Caută: dashboard multi-proiect, generare rapidă de documente, compliance batch
- Limbă: Română + Engleză

---

## 3. User Journeys

### J1 – Creare Proiect Nou
```
Pagina principală → "Proiect Nou" → Wizard pas-cu-pas:
  1. Tip organizație (IMM / ONG / UAT / Altul)
  2. Domeniu de activitate (CAEN / dropdown)
  3. Descriere idee proiect (text liber, minim 100 caractere)
  4. Buget estimat + Regiune (NUTS)
  5. → AI analizează și sugerează programe potrivite
  6. → Utilizatorul selectează programul → se deschide builder-ul
```

### J2 – Verificare Conformitate
```
Builder proiect → Tab "Conformitate" →
  1. AI scanează toate câmpurile completate
  2. Compară cu:
     - Ghidul Solicitantului (PDF ingerat)
     - Legislație aplicabilă (OUG, HG, Regulamente EU)
     - Criterii de eligibilitate per program
  3. Afișează: ✅ Conform / ⚠️ Atenție / ❌ Neconform
  4. Pentru fiecare problemă: explicație + sugestie de remediere
```

### J3 – Generare Propunere
```
Builder proiect (toate secțiunile completate) →
  "Generează Propunere" →
  1. AI compilează narrativul proiectului
  2. Generează: Rezumat, Justificare, Obiective SMART, Metodologie,
     Plan de implementare, Buget detaliat, Indicatori, Sustenabilitate
  3. Preview în format Word/PDF
  4. Utilizatorul editează inline
  5. Export final (.docx conform template-ului oficial)
```

### J4 – Matching Grant (Potrivire Finanțare)
```
Profil organizație completat →
  Dashboard → "Finanțări Disponibile" →
  1. AI face matching pe baza: domeniu, regiune, tip organizație, buget
  2. Scor de potrivire (0-100%)
  3. Filtre: Program (POCIDIF, POEO, PNRR, etc.), Deadline, Valoare
  4. Click → Detalii apel + "Începe Proiect pe Acest Apel"
```

---

## 4. Feature Specifications

### 4.1 Dashboard Principal
```
┌─────────────────────────────────────────────────┐
│  FondEU                    🔔 Notificări  👤 Ana │
├─────────────┬───────────────────────────────────┤
│ 📁 Proiecte │  Proiectele Mele                   │
│ 🔍 Finanțări│  ┌──────────┐ ┌──────────┐        │
│ 📋 Documente│  │ Proiect 1│ │ Proiect 2│        │
│ ⚖️ Legislație│  │ POCIDIF  │ │ PNRR     │        │
│ 📊 Rapoarte │  │ 75% ████ │ │ 40% ██   │        │
│ ⚙️ Setări   │  └──────────┘ └──────────┘        │
│             │                                    │
│             │  📢 Apeluri Noi Relevante          │
│             │  • POCIDIF 2.1 – Digitalizare IMM  │
│             │    Scor potrivire: 92%  Deadline:.. │
└─────────────┴───────────────────────────────────┘
```

### 4.2 Builder de Proiect (Secțiuni)
| Secțiune | Câmpuri | AI Assist |
|----------|---------|-----------|
| Informații Generale | Titlu, Acronim, Durată, Buget total | Sugestii titlu |
| Solicitant | Date organizație, Reprezentant legal, CAEN | Auto-fill din ONRC |
| Context & Justificare | Problemă, Nevoi, Grup țintă | Generare text |
| Obiective | Obiectiv general, Obiective specifice | SMART check |
| Metodologie | Activități, Sub-activități, Responsabili | Template per program |
| Buget | Linii bugetare, Cofinanțare, TVA | Calcul automat |
| Indicatori | Output, Rezultat, Impact | Sugestii per program |
| Parteneriat | Parteneri, Roluri, Acord | Template acord |
| Sustenabilitate | Plan post-implementare | Generare text |
| Anexe | Documente suport | Checklist |

### 4.3 Verificare Legislativă (AI Compliance)
- **Input:** Conținutul proiectului + programul selectat
- **Bază de date legislativă:**
  - Regulamente EU (ERDF, ESF+, CF, JTF)
  - OUG 66/2011 (actualizată)
  - HG 399/2015 (achiziții publice)
  - Ghiduri solicitant per apel
  - Scheme de ajutor de stat
- **Output:** Raport de conformitate cu referințe la articole specifice

### 4.4 Analiză Documente
- Upload PDF/Word → OCR dacă e nevoie → Extragere informații
- Documente suportate: bilanțuri, certificate, avize, studii fezabilitate
- AI extrage date relevante și le mapează pe câmpurile proiectului

### 4.5 Notificări
- Deadline-uri apropiate (7 zile, 3 zile, 1 zi)
- Apeluri noi relevante pentru profilul organizației
- Modificări legislative care afectează proiecte în lucru
- Corrigendum-uri la ghidurile solicitantului

---

## 5. Texte UI (Exemple Română)

```
"Creează un proiect nou"
"Verifică conformitatea"
"Generează propunerea"
"Caută finanțări disponibile"
"Încarcă document"
"Raport de conformitate"
"Scor de potrivire: 92%"
"⚠️ Atenție: Bugetul depășește plafonul maxim pentru această linie."
"❌ Neconform: Activitatea 3 nu are indicator de rezultat asociat."
"✅ Secțiunea 'Obiective' este conformă cu cerințele ghidului."
"Salvează ciornă"
"Exportă în format Word"
"Trimite pentru verificare"
```

---

## 6. Success Metrics

| Metric | Target (An 1) | Target (An 2) |
|--------|---------------|---------------|
| Utilizatori înregistrați | 500 | 3.000 |
| Proiecte create | 1.000 | 8.000 |
| Proiecte depuse (cu platforma) | 100 | 1.000 |
| Rata de succes proiecte depuse | >40% | >50% |
| NPS | >40 | >55 |
| Timp mediu pregătire proiect | -50% vs manual | -65% vs manual |
| Erori de conformitate detectate | 95% recall | 98% recall |
| Venit recurent lunar (MRR) | €5.000 | €35.000 |

---

## 7. Business Model

### Tier-uri
| Plan | Preț/lună | Include |
|------|-----------|---------|
| **Gratuit** | €0 | 1 proiect, matching basic, fără export |
| **Profesional** | €49 | 5 proiecte, compliance check, export Word |
| **Business** | €149 | 20 proiecte, AI generare completă, prioritate |
| **Enterprise** | Custom | Nelimitat, API, white-label, SLA |

### Revenue Streams
1. Subscripții lunare/anuale
2. Pay-per-project (€29/proiect pentru utilizatori ocazionali)
3. Parteneriate cu bănci/consultanți (referral fee)
4. Training & certificare (cursuri online)

---

## 8. Cerințe Non-Funcționale

- **Performanță:** Pagini < 2s, AI responses < 10s
- **Disponibilitate:** 99.5% uptime
- **Scalabilitate:** Suport 10.000 utilizatori concurenți
- **Securitate:** GDPR complet, date în EU (Frankfurt/București)
- **Accesibilitate:** WCAG 2.1 AA
- **Backup:** RPO 1h, RTO 4h
- **Limbi:** ro-RO (primar), en-GB (secundar)
