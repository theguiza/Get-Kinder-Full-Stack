import { parseFreeImpactAssessment } from "./kaiFreeImpactAssessmentComposition.js";
import { describeDerivedLimitationCode } from "../validators/kaiDerivedMeasurementValidators.js";

/**
 * The reader-facing layout of a released Free Impact Assessment, composed only
 * from its export-manifest render model: the six sections in order, the
 * released block text (each block's server-composed measurement disclosure is
 * shown as that block's limitations), a reference list with the human-stated
 * indicator label or document locator of each citation, and every limitation
 * described once with the references it applies to. It restates; it adds no
 * fact. A render model that is not an assessment returns null, and its
 * existing layout is unchanged.
 */

const DISCLOSURE_PATTERN = /\s*(Measurement disclosure for [\s\S]*)$/;

function text(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function shortId(value) {
  return text(value).slice(0, 8);
}

function splitDisclosure(body) {
  const match = DISCLOSURE_PATTERN.exec(body);
  if (!match) return { prose: body.trim(), disclosure: null };
  return { prose: body.slice(0, match.index).trim(), disclosure: match[1].trim() };
}

/** The assessment view of a render model, or null when it is not one. */
export function composeFreeImpactAssessmentView(renderModel) {
  const sections = parseFreeImpactAssessment(renderModel?.content?.blocks);
  if (!sections) return null;
  const context = renderModel.context || {};
  const labels = context.citationLabels || {};
  const references = (renderModel.citations || []).map((citation) => {
    const display = labels[citation.claimId] || null;
    const sources = [`source version ${shortId(citation.sourceVersionId)}`,
      ...(citation.contributingSources || []).filter((source) => source.sourceVersionId !== citation.sourceVersionId)
        .map((source) => `${source.sourceRole} source version ${shortId(source.sourceVersionId)}`)];
    return {
      citationRef: citation.citationRef,
      label: display?.label || "Cited claim",
      kind: display?.kind || null,
      fileKind: display?.fileKind || null,
      claimId: citation.claimId,
      evidenceItemId: citation.evidenceItemId,
      sources,
    };
  });
  const byDescription = new Map();
  for (const entry of renderModel.methodNotes?.limitationEntries || []) {
    for (const code of entry.limitationCodes || []) {
      const description = describeDerivedLimitationCode(code) || code;
      const refs = byDescription.get(description) || new Set();
      if (entry.citationRef) refs.add(entry.citationRef);
      byDescription.set(description, refs);
    }
  }
  const limitations = [...byDescription.entries()].map(([description, refs]) => ({ description, citationRefs: [...refs].sort() }));
  return {
    title: "Free Impact Assessment",
    organizationName: context.organizationName || null,
    engagementCode: context.engagementCode || null,
    reportIdentity: context.reportIdentity || null,
    reportingPeriod: context.reportingPeriodStart && context.reportingPeriodEnd ? `${context.reportingPeriodStart} to ${context.reportingPeriodEnd}` : null,
    audience: renderModel.exportCandidate?.requestedAudience || null,
    sections: sections.map((section, index) => ({
      number: index + 1,
      key: section.key,
      title: section.title,
      blocks: section.blocks.map((block) => ({ ...splitDisclosure(block.body), citationRefs: block.citationRefs || [] })),
    })),
    references,
    limitations,
    manifest: renderModel.manifest || null,
    renderModelContractVersion: renderModel.renderModelContractVersion,
    contentType: renderModel.exportCandidate?.contentType || null,
  };
}

function refsText(citationRefs) {
  return citationRefs.length > 0 ? ` ${citationRefs.map((ref) => `[${ref}]`).join(" ")}` : "";
}

function audienceSentence(audience) {
  return audience === "internal"
    ? "Released by Get Kinder for the organization's internal use only. It is not approved for funder or public use."
    : `Released by Get Kinder for the ${audience} audience.`;
}

const READING_NOTE = "Every figure restates a cited claim exactly, with its period, population and limitations. "
  + "Document statements are quoted from the organization's own documents and are source-reported. "
  + "The three improvements are proposals for the organization to consider, not measured or confirmed results.";

export function serializeFreeImpactAssessmentToMarkdown(view, { contractLine }) {
  const lines = [`# ${view.title}`, ""];
  if (view.organizationName) lines.push(`**Organization:** ${text(view.organizationName)}  `);
  if (view.reportIdentity || view.engagementCode) lines.push(`**Project:** ${text(view.reportIdentity || view.engagementCode)}  `);
  if (view.reportingPeriod) lines.push(`**Reporting period:** ${view.reportingPeriod}  `);
  lines.push(`**Status:** ${audienceSentence(view.audience)}`, "", `_${READING_NOTE}_`);
  for (const section of view.sections) {
    lines.push("", `## ${section.number}. ${section.title}`);
    section.blocks.forEach((block, index) => {
      const lead = section.key === "recommended_improvements" && block.prose.startsWith("Proposed change:") ? `**Improvement ${index + 1}.** ` : "";
      lines.push("", `${lead}${text(block.prose)}${refsText(block.citationRefs)}`);
      if (block.disclosure) lines.push("", `> _Limitations of the cited figures:_ ${text(block.disclosure)}`);
    });
  }
  lines.push("", "## Evidence and sources", "");
  for (const reference of view.references) {
    lines.push(`- [${reference.citationRef}] ${text(reference.label)}${reference.fileKind ? ` (${reference.fileKind} source)` : ""}; ${reference.sources.join("; ")}; claim \`${reference.claimId}\`.`);
  }
  lines.push("", "## Limitations and method notes", "");
  if (view.limitations.length === 0) lines.push("- none recorded");
  for (const limitation of view.limitations) lines.push(`- ${text(limitation.description)}${refsText(limitation.citationRefs)}`);
  lines.push("", "---", "", `${contractLine} · render model \`${text(view.renderModelContractVersion)}\` · draft type \`${text(view.contentType)}\`${view.manifest?.exportManifestId ? ` · manifest \`${view.manifest.exportManifestId}\`` : ""}`);
  return `${lines.join("\n")}\n`;
}

/** Writes the assessment into a pdfkit document (the existing PDF serializer's fonts and margins). */
export function renderFreeImpactAssessmentPdf(doc, view, { contractLine }) {
  doc.fontSize(20).font("Helvetica-Bold").text(view.title);
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica");
  if (view.organizationName) doc.text(`Organization: ${text(view.organizationName)}`);
  if (view.reportIdentity || view.engagementCode) doc.text(`Project: ${text(view.reportIdentity || view.engagementCode)}`);
  if (view.reportingPeriod) doc.text(`Reporting period: ${view.reportingPeriod}`);
  doc.text(audienceSentence(view.audience));
  doc.moveDown(0.3);
  doc.font("Helvetica-Oblique").text(READING_NOTE);
  for (const section of view.sections) {
    doc.moveDown(0.8);
    doc.fontSize(14).font("Helvetica-Bold").text(`${section.number}. ${section.title}`);
    section.blocks.forEach((block, index) => {
      doc.moveDown(0.4);
      if (section.key === "recommended_improvements" && block.prose.startsWith("Proposed change:")) doc.fontSize(11).font("Helvetica-Bold").text(`Improvement ${index + 1}`);
      doc.fontSize(11).font("Helvetica").text(`${text(block.prose)}${refsText(block.citationRefs)}`);
      if (block.disclosure) {
        doc.moveDown(0.2);
        doc.fontSize(8.5).font("Helvetica-Oblique").text(`Limitations of the cited figures: ${text(block.disclosure)}`);
      }
    });
  }
  doc.moveDown(0.8);
  doc.fontSize(14).font("Helvetica-Bold").text("Evidence and sources");
  doc.fontSize(9).font("Helvetica");
  for (const reference of view.references) {
    doc.text(`[${reference.citationRef}] ${text(reference.label)}${reference.fileKind ? ` (${reference.fileKind} source)` : ""}; ${reference.sources.join("; ")}; claim ${reference.claimId}.`);
  }
  doc.moveDown(0.8);
  doc.fontSize(14).font("Helvetica-Bold").text("Limitations and method notes");
  doc.fontSize(9).font("Helvetica");
  if (view.limitations.length === 0) doc.text("• none recorded");
  for (const limitation of view.limitations) doc.text(`• ${text(limitation.description)}${refsText(limitation.citationRefs)}`);
  doc.moveDown(0.8);
  doc.fontSize(8).font("Helvetica").text(`${contractLine}; render model ${text(view.renderModelContractVersion)}; draft type ${text(view.contentType)}.`);
}
