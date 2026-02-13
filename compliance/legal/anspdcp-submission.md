# Pachet de Conformitate ANSPDCP
## Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal

### 1. Informații Operator

- **Denumire:** [Numele companiei]
- **CUI:** [CUI]
- **Adresa:** [Adresa sediului social]
- **Responsabil Protecția Datelor (DPO):** [Nume, email, telefon]
- **Website:** https://funduri-ue.example.ro

### 2. Registrul Activităților de Prelucrare (Art. 30 GDPR)

| Activitate | Scop | Temei Legal | Categorii Date | Retenție |
|------------|------|-------------|----------------|----------|
| Înregistrare utilizatori | Creare cont | Executare contract | Nume, email, telefon | Durata contului + 1 an |
| Verificare organizație | Eligibilitate fonduri | Executare contract | CUI, date fiscale ANAF | 5 ani |
| Generare propuneri AI | Asistare redactare | Consimțământ | Text propunere (fără PII) | Durata proiectului |
| Semnătură electronică | QES eIDAS | Obligație legală | CNP, certificat digital | 10 ani |
| Jurnal audit | Securitate GDPR | Interes legitim | Acțiuni utilizator, IP | 6 ani |
| Analiză performanță | Îmbunătățire serviciu | Interes legitim | Date anonimizate utilizare | 2 ani |

### 3. Proceduri Notificare Încălcare (Art. 33-34)

#### 3.1 Notificare ANSPDCP (72 ore)
1. Detectare incident → echipa de securitate evaluează
2. Dacă implică date personale → notificare ANSPDCP în 72 ore
3. Portal notificare: https://www.dataprotection.ro/
4. Conținut: natura încălcării, categorii date, nr. persoane, consecințe, măsuri

#### 3.2 Notificare Persoane Vizate
- Doar dacă risc ridicat pentru drepturi și libertăți
- Limbaj clar, în limba română
- Fără întârziere nejustificată

### 4. Drepturi Persoane Vizate - Implementare

| Drept | Mecanism | Timp Răspuns |
|-------|----------|-------------|
| Acces (Art. 15) | Export automat din cont | 30 zile |
| Rectificare (Art. 16) | Self-service în cont | Imediat |
| Ștergere (Art. 17) | Cerere prin DPO | 30 zile |
| Restricționare (Art. 18) | Suspendare cont | 72 ore |
| Portabilitate (Art. 20) | Export JSON/CSV | 30 zile |
| Opoziție (Art. 21) | Email DPO | 30 zile |

### 5. Măsuri Tehnice și Organizatorice (Art. 32)

- Criptare date în tranzit și la repaus
- Control acces bazat pe roluri
- Autentificare multi-factor
- Jurnal audit complet
- Evaluare impact (DPIA) completată
- Plan răspuns incidente
- Backup automat cu testare restaurare
- Instruire personal privind protecția datelor

### 6. Transferuri Internaționale

- ✅ Toate datele stocate în UE (AWS eu-west-2, Londra)
- ✅ Niciun transfer în afara UE/SEE fără garanții adecvate
- ✅ Clauze contractuale standard (SCC) cu subprocesatorii non-UE
- ✅ Evaluare impact transfer (TIA) completată

### 7. Documente Anexate
1. DPIA Final (dpia-final.md)
2. Politica de Confidențialitate (privacy-policy-ro.md)
3. Termeni și Condiții (terms-of-service-ro.md)
4. Acord Prelucrare Date (data-processing-agreement.md)
5. Plan Răspuns Incidente (incident-response-plan.md)
