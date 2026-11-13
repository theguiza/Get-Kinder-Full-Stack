import React from "react";

import { interpretationBody, interpretationFormChanged } from "./clientDerivedMeasurementLogic.js";

/**
 * The organization's statement of what a recorded measurement means, asked as
 * three plain questions (owner direction 2026-11-13): what the value
 * represents, which direction is more favourable (paired outcomes only), and
 * where the recorded values come from. What KAI already established is shown
 * first (`known`), so the person answers only what KAI cannot tell from the
 * file. `initial` is the current recorded interpretation as a form (or the
 * empty form): a correction starts from it, "not established" stays the
 * default, and nothing is inferred from a label. `suggestion` is an optional
 * short name the server derived from the spreadsheet column heading: it is
 * shown as unconfirmed source context, and "Use this name" only copies it
 * into the short-name field for the person to keep, edit or replace. It
 * never fills the meaning, direction or basis. Opening, cancelling and using
 * the suggestion write nothing; only submitting posts, through the caller's
 * existing interpretation route. `attr` is the data-attribute prefix the caller's
 * existing controls already use (`<attr>-form`, `<attr>-field`,
 * `<attr>-submit`, `<attr>-cancel`).
 */
export default function MeaningQuestionsForm({
  attr, form, setForm, initial, paired, known = [], suggestion = null, note = null, pending = false, onSubmit, onCancel,
}) {
  const data = (suffix, value = "") => ({ [`${attr}-${suffix}`]: value });
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const correcting = Boolean(interpretationBody(initial, { paired }));
  const complete = Boolean(interpretationBody(form, { paired }));
  const changed = interpretationFormChanged(form, initial, { paired });
  const basisNumber = paired ? 3 : 2;
  return (
    <form className="mt-1 border rounded p-2" onSubmit={onSubmit} {...data("form")}>
      {known.length > 0 ? (
        <div className="mb-2" data-meaning-known="">
          <div className="fw-semibold">What KAI already established</div>
          <ul className="mb-0">{known.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      ) : null}
      <div className="text-muted mb-1" data-meaning-explanation="">
        KAI cannot tell from the file what these values mean. Your answers are recorded as your organization&apos;s statement; KAI does not
        check them, and they never change the numbers. If you are not sure of an answer, leave it as not established.
      </div>
      {note ? <div className="text-muted mb-1" data-meaning-note="">{note}</div> : null}
      {correcting ? (
        <div className="text-muted mb-1" data-meaning-prefilled="">
          The answers currently recorded are filled in. Change only what is different; the rest is kept as recorded.
        </div>
      ) : null}
      <fieldset className="mb-2" data-meaning-question="represents">
        <legend className="fs-6 fw-semibold mb-1">1. What does this measured value represent?</legend>
        {suggestion ? (
          <div className="border rounded p-2 mb-1 bg-light" data-meaning-suggestion="">
            <div className="fw-semibold">Suggested from the spreadsheet column heading</div>
            <div data-meaning-suggestion-label="">{suggestion}</div>
            <div className="text-muted" data-meaning-suggestion-note="">
              This description comes from the source heading. Your organization has not yet confirmed what the measurement represents.
            </div>
            <button type="button" className="btn btn-sm btn-outline-secondary mt-1" data-meaning-suggestion-use=""
              disabled={Boolean(pending) || form.indicatorLabel === suggestion}
              onClick={() => setForm((current) => ({ ...current, indicatorLabel: suggestion }))}>
              Use this name
            </button>
          </div>
        ) : null}
        <label className="d-block">
          A short name for it
          <input className="form-control form-control-sm" value={form.indicatorLabel} {...data("field", "indicatorLabel")}
            onChange={set("indicatorLabel")} />
        </label>
        <label className="d-block">
          In a sentence, what the value describes
          <input className="form-control form-control-sm" value={form.meaningText} {...data("field", "meaningText")}
            onChange={set("meaningText")} />
        </label>
      </fieldset>
      {paired ? (
        <fieldset className="mb-2" data-meaning-question="direction">
          <legend className="fs-6 fw-semibold mb-1">2. Is a higher or a lower score the more favourable result?</legend>
          <select className="form-select form-select-sm" value={form.scoreDirection} {...data("field", "scoreDirection")}
            onChange={set("scoreDirection")} aria-label="Which score is more favourable">
            <option value="">Not established: leave the direction open</option>
            <option value="higher_is_better">A higher score is more favourable</option>
            <option value="lower_is_better">A lower score is more favourable</option>
          </select>
          <div className="text-muted">While the direction is open, KAI reports a change as a numerical change only, never as progress or decline.</div>
        </fieldset>
      ) : null}
      <fieldset className="mb-2" data-meaning-question="basis">
        <legend className="fs-6 fw-semibold mb-1">{basisNumber}. What is the source or basis of these recorded values?</legend>
        <select className="form-select form-select-sm" value={form.evidenceBasis} {...data("field", "evidenceBasis")}
          onChange={set("evidenceBasis")} aria-label="Source of the recorded values">
          <option value="not_established">Not stated</option>
          <option value="self_reported">Self-reported by the people recorded</option>
          <option value="organization_record">The organization&apos;s own records</option>
        </select>
      </fieldset>
      {correcting && complete && !changed ? <div className="text-muted mb-1" data-meaning-unchanged="">Nothing has been changed yet.</div> : null}
      <button type="submit" className="btn btn-sm btn-primary me-1" disabled={Boolean(pending) || !complete || (correcting && !changed)}
        {...data("submit")}>
        {pending ? "Recording..." : correcting ? "Record the correction" : "Record meaning"}
      </button>
      <button type="button" className="btn btn-sm btn-outline-secondary" disabled={Boolean(pending)} onClick={onCancel} {...data("cancel")}>
        Cancel
      </button>
    </form>
  );
}
