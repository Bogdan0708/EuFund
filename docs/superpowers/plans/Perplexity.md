You already have a very strong technical redesign plan; what’s missing is an explicit UX layer that’s grounded in how non-technical users actually move through “get EU money” as a life event, not as screens and tables. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)

Below is a concrete UX audit and redesign framework tailored to your current two-page concept (Chat + Projects) and the 7‑step orchestrator, aligned with recent EU/public-sector UX guidance and 2026 design trends. [ec.europa](https://ec.europa.eu/digital-building-blocks/sites/display/OOTS/UX+recommendations)

***

## 1. UX audit framing for FondEU

Use this as a checklist to review the existing product before changing flows.

1. Map real journeys, not features  
   - Define 3–4 core journeys: “New founder who heard about a call”, “Consultant managing 10 projects”, “Public institution writing a big Horizon proposal”.  
   - For each, capture: entry point, main goal, key questions (“Can I apply?”, “How much can I get?”, “What do I do next?”), and where they currently drop off.

2. Score each journey on four axes (0–5)  
   - Clarity: Can a non‑expert understand what to do next on every step?  
   - Cognitive load: How many concepts must they juggle at once (program, call, eligibility, partner search, documents, deadlines)?  
   - Confidence: Do they feel “I’m doing this right and won’t miss something critical”?  
   - Speed to value: Time from landing to “aha” (e.g. seeing a personalised shortlist of calls).

3. Run a lean usability test per persona  
   - 5 users per segment is enough: give them realistic tasks like “Find a call you are eligible for and start a project draft”.  
   - Measure task success, time on task, and ask 1–2 post‑task questions (“What was confusing?”, “What gave you confidence?”). [responsible.eldris](https://responsible.eldris.ai/data-centre/eu-responsible-person-compliance/best-practices-ux-design-2024-eu-compliance)

Outcome: a short UX audit doc that directly informs which parts of your orchestrator and UI to simplify first.

***

## 2. Recommended UX shape: how the 2-page app should feel

You already target “Chat + Projects”; the key is to make Chat the **primary** entry for everything, with Projects as the structured brain.

### a) Chat page (AI orchestrator as service pattern)

Think of this as a guided public-service “pattern” rather than a generic chatbot. [publicpolicydesign.blog.gov](https://publicpolicydesign.blog.gov.uk/2025/11/06/patterns-for-the-global-public-sector/)

- Single intent box with 3–5 prominent quick starts  
  - Examples: “Check if I’m eligible for EU funds”, “Find open calls for my idea”, “Improve a draft application I already wrote”.  
  - Each quick start should map to a known internal workflow template (7‑step pipeline variants).

- 7‑step orchestrator presented as a vertical, collapsible journey  
  - Always visible progress (e.g. “1. Understand your idea → 2. Match to programmes → … → 7. Export application draft”).  
  - Each step has: short plain-language label, one‑line explanation, and current status (in progress / done / needs info).

- Conversation designed as explainable copilot, not magic  
  - After each major step, the AI should explicitly summarise what it just did, and why it suggests certain calls, with simple bullet points.  
  - Offer a single next action: “Looks good → proceed”, “Change filters”, “Ask a human consultant”.

- Reduce visible fields per step  
  - Ask for minimal info first (sector, country, approximate budget, legal form), then progressively disclose advanced parameters.  
  - Use chips and predefined answers over free text wherever possible (e.g. sectors list, TRL levels, organisation types).

### b) Projects page (control center for complexity)

This should feel like a “portfolio of funding attempts”, not a generic project management tool.

- Card/list view with three key signals per project  
  - Status along your new projectStatusEnumV2 (e.g. “Draft”, “Action plan”, “Built”, “Exported”). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)
  - Next critical date (closest call deadline, internal milestone).  
  - Confidence/coverage indicator (e.g. “Eligibility: 80%, Documents: 3/7 uploaded”).

- Per‑project layout  
  - Left: sections from project_documents (Objectives, Workplan, Budget, Impact, etc.), each with AI status (draft/review/final). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)
  - Right: chat history and AI “change log” (edit agent activity, what was regenerated and why). [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)
  - Top: banner with the matched call(s), deadlines, and funding rate, with a very clear “Export for this call” button.

- Explicit collaboration affordances using team_members  
  - “Invite collaborator by email”, with clear roles (owner, editor, viewer).  
  - Simple activity feed: “Mara updated Budget section”, “AI regenerated Workplan, v3”. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)

***

## 3. UX best practices for EU/public‑sector funding tools

These are patterns drawn from EU UX recommendations and government service design work, adapted to your context. [youtube](https://www.youtube.com/watch?v=0z3trE1RAlk)

1. Consistency of language and concepts  
   - Pick one vocabulary and stick to it everywhere: “Programme → Call → Project → Application”, “Funding rate”, “Beneficiary”, etc. [ec.europa](https://ec.europa.eu/digital-building-blocks/sites/display/OOTS/UX+recommendations)
   - Add inline “?” explanations or glossary popovers for domain terms like TRL, cascade funding, lump sums.

2. Accessibility and compliance as a first‑class constraint  
   - Design to hit WCAG 2.1 AA now and track European Accessibility Act requirements for 2025+ products. [six2eight](https://six2eight.com/blog/ui-ux-design-trends)
   - Concrete: sufficient colour contrast, focus states, keyboard navigation, clear error messages, no AI‑only critical information.

3. Pattern‑based journeys  
   - Treat the 7‑step orchestrator as a reusable “Apply for funding” pattern that could later support other programmes or national schemes. [publicpolicydesign.blog.gov](https://publicpolicydesign.blog.gov.uk/2025/11/06/patterns-for-the-global-public-sector/)
   - Document it as a pattern: context, problem, solution, examples, and implementation notes.

4. Trust, explainability, and data safety  
   - Clearly show when content is AI‑generated vs. user‑authored (e.g. AI badge, last regenerated timestamp). [responsible.eldris](https://responsible.eldris.ai/data-centre/eu-responsible-person-compliance/best-practices-ux-design-2024-eu-compliance)
   - Inline disclosures about what data is stored, for how long, and where (especially for budget and personal data).

5. Progressive disclosure for expert features  
   - Advanced features (multi‑call comparison, partner search, complex budget modelling) should appear only after a solid basic path works.  
   - Provide “I’m an advanced user” toggles or an “expert mode” that exposes raw data and filters.

***

## 4. Tying UX to your orchestrator architecture

You already have strong back‑end primitives; here’s how to expose them UX‑wise. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)

### a) SSE streaming + Redis Pub/Sub → conversational feedback

- Use streams not just for token‑by‑token text, but for visible UI events:  
  - “StepMoved”, “CallMatched”, “DocumentGenerated”, “EditApplied”. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)
- Surface those events as small, time‑stamped toasts and timeline items so the user feels the orchestrator is doing discrete, auditable actions, not a black box process.

### b) workflow_sessions & workflow_messages → session UX

- Let users resume where they left off with a prominent “Continue last session” banner linking to the last active workflow_session. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)
- Show a compact session history (list of recent “conversations/projects”) rather than overwhelming them with all workflow messages.

### c) project_documents + edit agent → document editing UX

- Apply your post‑completion editing as a very clear pattern:  
  - Each section has a “Ask AI to improve” entry point, with a small modal for instructions and a diff view (“Before / After”) tied to versions. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)
- Enforce clear limits by tier (e.g. “You have 3 edits left on this project in Free tier”) so the business model is visible, not hidden. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)

### d) lifecycle and limits → UX for tiers

- Use getTierLimits to drive visible limits: “Max 2 active AI sessions” or “Up to 5 projects”. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)
- When limits hit, the UI should explain exactly what’s happening (which sessions were paused, why) and offer one action: “Upgrade” or “Close old sessions”. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/93589900/1ae106c4-c9b7-4747-a181-b5efbf8bd10b/2026-03-19-orchestrator-redesign-plan.md?AWSAccessKeyId=ASIA2F3EMEYE5AVTEDOI&Signature=vcCU%2FMT1Pskuh%2F0M6UJkpLGRCMo%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEFIaCXVzLWVhc3QtMSJHMEUCIFUSDqvpOl5aKi431j%2FjzBDF3mQiYiJEXIOxMnMtypP8AiEAuuE%2B%2BFLe84uIoRERPVAgtiytjUep3MUsoSBynu2Rihkq8wQIGxABGgw2OTk3NTMzMDk3MDUiDKCwRGJXX8mL%2BYseryrQBBhCZOnSFZUH6eco9UqeGl8Kx3jn1PMprp4F7SqJp%2FGz9PwK0e0PnfcjXiZvU%2By8DMOzDSsd2gOOERZhyjq40UXFLnn5DT%2Bp9ENpG%2B0%2FbflgYy8xBt7BQpbnu4HvkaecpUASN6la2d%2BatfwBFw0xFGEPm6pjxNHRXghDOZBLUV5hN3J0kqbLHB%2B434AC54VZrTMPr7GCebE2EQxOyuhyBb9%2F6LfR5Qn0wqTaKBIODmkGcpOqNYLdvmq93JSRYTQq5iEDeQx2q3IMJX96pzo8Sh5s%2BUQp0KbkppO0LaH6yElUDiJUYqiSSGDX6008%2FixHaUa1rK0xpmn4XvNYrGYwkXDJeD5pxZN6AhvtVzxM8KAnrz6iQGYC2cvF%2Fo2doA8A610in47lusrVz1djXvHIKRxIc1wasGq%2BsYVoIWkPwGSZndiju%2BpeYvbhRzilGlUZ3CdHzwDbAEiapWI8Oa0nEZcOtDgKpethtSncXD8DFhrZ%2BAc3k9A762pVLOXCAGCQsnVSFDAJRe7%2FKNF8jWDnjZanFFbkpjAuu4iXiXuvFJs8CrSpBoV4iVCAY1ZnpJVzUUMtCgp7QVo9pFGNh6No0WBNtEpEPtbuzdU%2BUarRp%2BDuLupVV1MoWK%2B1WlRuZ4aOvIZVwku8w5ZbE9%2Bx9J6ChGksmzEKGpeWnKcLqvAMzDDTDZp6UFQFHlRsKPfgND58i3U0Kf%2Fu%2Fq%2Bcu10yqAycs%2F1zcl1jYILr9wiKwBakfBZxso29306aHWjGAXY7E3w%2Fg34ogHILNkVdP1e431%2FArmcwgYjvzQY6mAH%2BknwPIu2UURB4eQmr3z%2F4SRzcolZS3axZcEjkB5slfJcRfea9IqFIuf9GUuK%2F5lotYrFKEefhjLd9F01UAH%2FQsHUWgPhV8uvaOxm52x9n0FYrDCP5H9NKyXyUIAiOlMMFWTqN9rWoz9uJG6C7CndRG34u432zH%2B%2B7gap42l3EufPMDBLvlPD0xgoa3Juap9jC1GBxa24pVA%3D%3D&Expires=1773914922)

***

## 5. Minimal roadmap: UX‑first iterations

Here is a lean sequence you can realistically deliver alongside your technical phases. [six2eight](https://six2eight.com/blog/ui-ux-design-trends)

1. UX audit + journey mapping (1 week)  
   - Produce: personas, 3–4 main journeys, pain point list, and a prioritised UX backlog.

2. Orchestrator UX skeleton (1–2 weeks)  
   - Implement: Chat landing with quick starts, visible 7‑step vertical journey, basic progress indicators.  
   - No advanced filters yet; just enough to test the concept.

3. Projects centre v1 (1 week)  
   - Basic project cards with status, matched call, and “Open project workspace”.  
   - Inside, simple sections list and chat side panel.

4. Usability tests + adjustments (continuous)  
   - Every 2–3 weeks, run 4–5 user sessions and fix the top 3 issues discovered.

5. Advanced features (after base is stable)  
   - Collaboration, multi‑call comparison, budget toolkit, analytics.

***

To prioritise correctly: what’s your primary target segment for the next 6–12 months (solo founders/SMEs, consultants, or public institutions)?