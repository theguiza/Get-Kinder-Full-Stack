# KAI MVP Sprint 2 — Client Data Processing Addendum (DRAFT v0.1)

> **DRAFT — requires final business/legal review before execution with a client.** This document is not a binding agreement, is not legal advice, and must not be signed, referenced as executed, or relied upon in a live client engagement until counsel has reviewed and approved it.

**Source of policy:** This addendum implements, and must be read consistently with, `KAI_MVP_Sprint2_Data_Protection_and_Processing_Operating_Model_v0.2.md` ("the Operating Model"). Where any ambiguity exists between this addendum and the Operating Model, the Operating Model governs and this addendum should be revised to match it.

---

## 1. Parties and Role

- **Client** owns client-uploaded data and any data client submits, imports, or generates through the KAI service.
- **Get Kinder** provides the KAI platform and, in delivering the subscribed service, acts as a service provider/processor processing client data on client's behalf and for the purposes described below.
- **Client** remains responsible for having its own lawful authority (collection, consent, disclosure, or other legal basis) for the data it submits to KAI. Get Kinder does not independently verify client's collection or consent authority.

---

## 2. Processing Purpose

Get Kinder processes client data to:

- operate the KAI service;
- analyze, profile, and classify data;
- extract evidence;
- propose claims;
- generate reports and funder/client drafts;
- improve KAI's recommendations; and
- improve Get Kinder/KAI programs, services, impact measurement, and service quality, where covered by the applicable agreements and disclosures.

---

## 3. Data Use

- Ordinary KAI processing (profiling, analysis, evidence extraction, claim proposal, drafting) does not require a separate consent decision at each internal processing step, where the applicable agreement already authorizes the purpose.
- Get Kinder will not disclose client's identifiable data to another client unless separately authorized.
- Anonymized or aggregated cross-client learning is permitted.
- Identifiable information may be used for Get Kinder/KAI improvement where covered by the applicable disclosure, consent, or contractual basis.

---

## 4. AI Processing

- Approved AI providers may process information required to deliver the KAI service, including personal information where covered by the applicable processing basis.
- External foundation-model training using KAI client data is disabled and not intentionally opted into by default.
- External foundation-model training is distinct from, and does not include, Get Kinder/KAI service improvement, which is addressed in Sections 2 and 3.
- AI processing is not represented as having zero data retention. Provider-side processing and any temporary retention are governed by Get Kinder's applicable commercial arrangement with that provider.

---

## 5. Data Location

- Raw uploaded client files are stored in Get Kinder's approved Canadian Google Cloud Storage configuration.
- KAI application, runtime, operational metadata, and derived records may operate through Render, which may process and store data outside Canada.
- Approved AI providers may process data required to provide the KAI service; this processing does not change the location of KAI's raw-file storage.
- Get Kinder does not offer client-specific or custom data-residency configurations as part of the MVP.

---

## 6. Subprocessors

Get Kinder maintains the following lightweight record of material service providers that process KAI client information:

| Provider | Purpose | Data Category | Location Posture |
|---|---|---|---|
| Google Cloud Storage | Raw file storage | Raw uploaded client files | Canada (Toronto) |
| Anthropic API | AI-assisted processing | Data required for KAI analysis | United States |
| Render | Application/runtime hosting, metadata, logs, workers | Application, operational metadata, derived records | United States |
| Google Workspace / Gmail SMTP | Transactional/operational email | Email content as applicable | Provider-managed |
| Google OAuth | Authentication | Authentication credentials/identifiers | Provider-managed |
| Meta/Facebook OAuth | Authentication | Authentication credentials/identifiers | Provider-managed |

Malware scanning is performed using self-hosted ClamAV; no external malware-scanning SaaS is used. No external logging/APM, analytics/telemetry, or queue/cache providers are in active use as of this draft.

This register may be updated by Get Kinder as the service evolves and is an operational reference, not a certification exercise.

---

## 7. Security

- Raw client files are stored privately, not publicly accessible.
- Access to the service requires authentication.
- Client data is tenant-isolated from other clients.
- Access to raw client data is restricted to personnel and providers with a legitimate operational need.
- KAI's validators and service-level controls govern processing and access.
- Passwords, credentials, and signed URLs are not placed in ordinary support communications.
- Content within uploaded files is treated as untrusted data; instructions embedded in uploaded files are not treated as authoritative commands to KAI or Get Kinder systems.

---

## 8. Human Review

- Get Kinder owns the normal KAI review process during the MVP.
- Client review is requested only where client knowledge is materially useful to resolve factual uncertainty, client-specific definitions, consent/story questions, governance questions, or material interpretation issues.
- KAI may analyze and draft outputs before any review occurs.
- Consequential external release of KAI outputs remains subject to appropriate Get Kinder review.

---

## 9. Retention and Offboarding

- **Active subscription:** Get Kinder retains client data reasonably needed to operate, maintain, and improve the service.
- **Cancellation/non-renewal:** a 90-day recovery/export/reactivation period follows, during which client data remains available and client may reactivate. No automatic destructive deletion occurs during this period.
- **After 90 days:** Get Kinder reviews whether data should be retained, anonymized, or deleted. Raw files should normally be among the first records considered for deletion or anonymization following offboarding.
- **Audit records:** metadata-only audit records are retained for 24 months by default.
- A legal, regulatory, or contractual hold overrides and pauses deletion of the affected data.

---

## 10. Deletion

- Destructive deletion requires an authorized Get Kinder human action.
- Deletion may be requested by client or triggered by the offboarding disposition review.
- Deletion actions are auditable.
- No automated destructive deletion occurs during the MVP.

---

## 11. Incidents

Get Kinder's MVP incident-response process is:

**Contain → Assess → Notify → Fix → Record.**

Client will be notified when required by the applicable agreement or law. No fixed contractual notification-time commitment (e.g., a 72-hour window) is made under this addendum.

---

## 12. Support Access

- Support and administrative access to client data is limited to Get Kinder personnel and authorized service providers with a reasonable operational need.
- Shared credentials are not used; access is authenticated on an individual basis.
- Raw client data is accessed only where reasonably necessary for an authorized service, review, or support purpose.
- Material access to raw client data is auditable.

---

## 13. Confidentiality

Client data is used only for the authorized service, program, and improvement purposes described in this addendum and the Operating Model. Access is restricted to Get Kinder personnel and providers with a legitimate need to access it.

---

## 14. Subprocessor Changes

Get Kinder may update its material subprocessors as the service evolves and will maintain a current material-provider record (Section 6). No advance-approval process is required for ordinary provider changes under the MVP.

---

## 15. Termination

On termination, the 90-day offboarding lifecycle described in Section 9 applies: recovery/export/reactivation for 90 days, followed by Get Kinder's disposition review (retain, anonymize, or delete).

---

## 16. No Warranty / Legal Draft Status

**This document is a DRAFT.** It has not been reviewed or approved by legal counsel and must not be executed, relied upon, or represented to any client as a binding agreement until final business and legal review is complete.

---

*End of draft.*
