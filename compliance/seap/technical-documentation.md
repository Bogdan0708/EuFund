# Documentație Tehnică - Platforma de Fonduri UE
## Pentru Înregistrare SEAP (Sistemul Electronic de Achiziții Publice)

### 1. Prezentare Generală

**Nume Produs:** Platforma de Fonduri UE (EU Funds Platform)
**Versiune:** 1.0
**Tip:** Aplicație web SaaS pentru managementul propunerilor de finanțare europeană

### 2. Arhitectură Sistem

#### 2.1 Componente
- **Frontend:** Next.js 14 cu React 18, TypeScript, Tailwind CSS
- **Backend:** Next.js API Routes, Drizzle ORM
- **Bază de Date:** PostgreSQL 15 (AWS RDS Aurora, Multi-AZ)
- **Cache:** Redis 7 (AWS ElastiCache)
- **Autentificare:** NextAuth.js cu OAuth2/OIDC
- **Semnătură Electronică Calificată:** certSIGN.ro (eIDAS compliant)
- **Inteligență Artificială:** OpenAI GPT pentru generarea propunerilor

#### 2.2 Integrări Guvernamentale Române
- **ONRC** - Verificare date companie (CUI, denumire, adresă)
- **ANAF** - Verificare date fiscale, bilanțuri
- **MySMIS 2021** - Depunere propuneri de finanțare
- **certSIGN** - Semnătură electronică calificată (QES)

#### 2.3 Infrastructură
- **Cloud:** AWS eu-west-2 (Londra) - conform GDPR
- **CDN:** CloudFront cu locații edge pentru România
- **Container:** ECS Fargate cu auto-scaling
- **Backup:** Automat zilnic, retenție 30 zile
- **DR:** Multi-AZ, RPO <1 oră, RTO <4 ore

### 3. Securitate

#### 3.1 Măsuri Tehnice (GDPR Articolul 32)
- Criptare la transport: TLS 1.2+ (rating A+ SSL Labs)
- Criptare la repaus: AES-256 pentru baza de date
- WAF (Web Application Firewall) cu reguli OWASP Top 10
- Rate limiting și protecție DDoS
- Audit logging complet (GDPR)
- Scanare automată vulnerabilități (săptămânal)

#### 3.2 Autentificare și Autorizare
- Autentificare multi-factor (MFA) opțional
- Sesiuni cu expirare automată (24h)
- Control acces bazat pe roluri (RBAC)
- Izolare date multi-tenant

#### 3.3 Conformitate
- **GDPR** - Evaluarea impactului asupra protecției datelor (DPIA) completată
- **eIDAS** - Semnătură electronică calificată prin certSIGN
- **OWASP Top 10** - Verificare completă
- **ISO 27001** - Pregătire în curs

### 4. Performanță

| Metric | Țintă | SLA |
|--------|-------|-----|
| Timp încărcare pagină | <2s | 95% cereri |
| Răspuns API | <500ms | 99% cereri |
| Disponibilitate | 99.9% | Lunar |
| Scalabilitate | 1000+ utilizatori concurenți | Auto-scaling |

### 5. Rezidența Datelor
- Toate datele stocate exclusiv în UE (AWS eu-west-2)
- Fără transfer de date în afara UE/SEE
- Backup-uri criptate în aceeași regiune
- Subprocesatori cu clauze contractuale standard (SCC) unde este cazul

### 6. Suport și Mentenanță
- Suport tehnic: Luni-Vineri, 08:00-18:00 (ora României)
- Timp răspuns incidente critice: 15 minute
- Actualizări de securitate: în termen de 24 ore
- Mentenanță planificată: noaptea, cu notificare prealabilă

### 7. Contact Tehnic
- Email: suport@eufunds.example.ro
- Telefon: [TBD]
- Responsabil protecția datelor (DPO): [TBD]
