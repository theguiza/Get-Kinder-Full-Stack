"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";


// -------------------------
// Types
// -------------------------
export type OnboardingStep = {
  id: string;
  title: string;
  description?: string;
  type: "single" | "multi" | "range" | "text";
  options?: Array<{ id: string; label: string; helper?: string }>; // for single/multi
  min?: number; // for range
  max?: number; // for range
  placeholder?: string; // for single text
  placeholders?: string[]; // for multi-field text input
  required?: boolean;
};

export type OnboardingAnswer = Record<string, string | string[] | number | null>;

export type OnboardingCardsProps = {
  /** Ordered list of onboarding steps. Can be omitted — we fall back safely. */
  steps?: OnboardingStep[];
  /** Optional fallback steps if `steps` is empty; otherwise we use a built-in demo preset. */
  fallbackSteps?: OnboardingStep[];
  /** Force-show onboarding even if the completion cookie is present (dev convenience). */
  forceShow?: boolean;
  storageKey?: string; // local draft key
  cookieName?: string; // completion cookie
  onComplete?: (answers: OnboardingAnswer) => void | Promise<void>;
  onClose?: () => void; // if you render as a modal/drawer
  brand?: {
    logoUrl?: string;
    productName?: string;
  };
};

// -------------------------
// Helpers
// -------------------------
const DEFAULT_STORAGE_KEY = "onboarding.draft";
const DEFAULT_COOKIE = "onboarding_done";

export function setClientCookie(name: string, value: string, maxAgeSeconds = 31536000) {
  try {
    document.cookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/`;
  } catch {}
}

export function getClientCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function saveDraft(key: string, answers: OnboardingAnswer, index: number) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, answers, index, ts: Date.now() }));
  } catch {}
}

function loadDraft(key: string): { answers: OnboardingAnswer; index: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.v === 1 && typeof data.index === "number" && data.answers) {
      return { answers: data.answers, index: data.index };
    }
  } catch {}
  return null;
}

function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
// Inject minimal CSS so component looks correct without Tailwind
function ensureOnboardingStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("kai-onboarding-styles")) return;
  const css = `
  .kai-title { color: #ff5656; }
  .kai-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: nowrap; }
  .kai-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
  .kai-onboarding * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
  .kai-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
  @media (min-width: 640px) { .kai-grid { grid-template-columns: 1fr 1fr; } }

  .kai-card-option { border: 1px solid #e5e7eb; padding: 16px; border-radius: 12px; background: #fff; cursor: pointer; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease; text-align: left; }
  .kai-card-option:hover { background: #f9fafb; }
  .kai-card-option.is-selected { border-color: #111827; background: #f3f4f6; box-shadow: 0 0 0 2px rgba(17,24,39,0.05) inset; }

  .kai-input { width: 100%; border: 1px solid #e5e7eb; border-radius: 12px; padding: 8px 12px; font-size: 14px; color: #455a7c; }
  .kai-input::placeholder { color: #455a7c; opacity: .9; }
  .kai-input:focus { outline: none; border-color: #111827; }

  .kai-btn { border-radius: 12px; padding: 8px 16px; font-weight: 600; font-size: 14px; line-height: 1.2; display: inline-flex; align-items: center; gap: 8px; }
  .kai-btn-primary { background: #ff5656; color: #fff; border: none; }
  .kai-btn-primary:hover { filter: brightness(0.95); }
  .kai-btn-primary:disabled { opacity: .4; cursor: not-allowed; }
  .kai-btn-outline { border: 1px solid #e5e7eb; color: #455a7c; background: #fff; }
  .kai-btn-outline:hover { background: #f9fafb; }

  .kai-range { width: 100%; }
  .kai-range::-webkit-slider-runnable-track { height: 4px; background: #e5e7eb; border-radius: 999px; }
  .kai-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; background: #ff5656; border-radius: 50%; cursor: pointer; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.1); margin-top: -7px; }
  .kai-range::-moz-range-track { height: 4px; background: #e5e7eb; border-radius: 999px; }
  .kai-range::-moz-range-thumb { width: 18px; height: 18px; background: #ff5656; border: none; border-radius: 50%; cursor: pointer; }
  `;
  const style = document.createElement("style");
  style.id = "kai-onboarding-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

// Simple analytics shim — replace with your instrumentation
function track(event: string, props?: Record<string, any>) {
  // eslint-disable-next-line no-console
  console.debug(`[analytics] ${event}`, props || {});
}

// Query helpers & debug mode (runtime-safe; no process.env usage)
function getQueryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function isLocalhost(): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  } catch {
    return false;
  }
}

function isDebug(): boolean {
  const q = getQueryParam("debug");
  return (q === "1") || isLocalhost();
}

// Utility: validate steps
function normalizeSteps(input?: OnboardingStep[]): OnboardingStep[] {
  return Array.isArray(input) ? input.filter(Boolean) : [];
}

function clampIndexForSteps(idx: number, stepsLen: number) {
  if (!stepsLen) return 0; // avoid negatives when no steps
  return Math.max(0, Math.min(idx, stepsLen - 1));
}

// Default preset used when no steps are provided
export function getDefaultSteps(): OnboardingStep[] {
  return [
    {
      id: "whyFriend",
      title: "Why are you looking for a friend?",
      description: "This helps KAI focus on how to help you to achieve your goal.",
      type: "single",
      required: true,
      options: [
        { id: "move", label: "I moved" },
        { id: "school", label: "I am at a new school / job" },
        { id: "break-up", label: "I recently ended a relationship" },
        { id: "goal", label: "New Years Resolution or life goal" },
        { id: "specific", label: "Seeking a partner for a specific activity" },
        { id: "lonely", label: "I just want a new friend" },
        { id: "other", label: "I have another reason" },
      ],
    },
    {
      id: "knownConnection",
      title: "Do you have some people in mind that you would like to connect with?",
      description: "If you do the best place to start is with the friendship quiz so KAI can customize your approach to making them your new best friend.",
      type: "single",
      required: true,
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    },
    {
      id: "outcome",
      title: "What is your desired outcome?",
      description: "Confirm with KAI your goal for your initial friend so he can help you achieve it.",
      type: "single",
      required: true,
      options: [
        { id: "bestie", label: "Find my next best friend" },
        { id: "circle", label: "Expand my current friend circle" },
        { id: "casual", label: "Find someone to hang out with IRL" },
        { id: "lonely", label: "Feel less bored or lonely" },
        { id: "activity", label: "Find partner for a specific activity" },
        { id: "another", label: "I have another desired outcome" },
      ],
    },
    {
      id: "timeCommitment",
      title: "How many hours per week do you plan to spend on making your new friend?",
      description: "Making friends just got easier, but it does take time. The more quality time you spend together the better!",
      type: "range",
      required: true,
      min: 0,
      max: 10,
    },
    {
      id: "interests",
      title: "What are your main interests?",
      description: "Tell KAI what your interests are so he can find the right activities for you and your new best friend.",
      type: "text",
      placeholders: ["Your interest 1", "Your interest 2", "Your interest 3"],
      required: false,
    },
    {
      id: "age",
      title: "How old are you?",
      description: "Tell KAI your age for age-appropriate suggestions and activities. Log in to save your answers.",
      type: "single",
      required: true,
      options: [
        { id: "youth", label: "Under 18" },
        { id: "18-24", label: "18-24" },
        { id: "25-34", label: "25-34" },
        { id: "35-44", label: "35-44" },
        { id: "45-54", label: "45-54" },
        { id: "55-64", label: "55-64" },
        { id: "65+", label: "65+" },
      ],
    },
  ];
}

// Resolves the actual steps to render and whether we fell back.
export function resolveSteps(
  stepsProp: OnboardingStep[] | undefined,
  fallbackSteps: OnboardingStep[] | undefined
): { steps: OnboardingStep[]; usingFallback: boolean } {
  const normalized = normalizeSteps(stepsProp);
  if (normalized.length > 0) return { steps: normalized, usingFallback: false };
  const fb = normalizeSteps(fallbackSteps);
  return { steps: fb.length > 0 ? fb : getDefaultSteps(), usingFallback: true };
}

// Debug helpers: allow forcing onboarding via query param or localhost
function getDebugForceShow(): boolean {
  const q1 = getQueryParam("onboarding");
  const q2 = getQueryParam("forceOnboarding");
  return q1 === "1" || q2 === "1";
}

function getEffectiveForceShow(forceShowProp: boolean | undefined): boolean {
  const query = getDebugForceShow();
  const localDefault = isLocalhost() && forceShowProp == null; // auto-force on localhost if no prop provided
  return Boolean(forceShowProp || query || localDefault);
}

function shouldSuppress(forceShow: boolean | undefined, cookieName: string) {
  const effective = getEffectiveForceShow(forceShow);
  if (effective) return false;
  const cookie = getClientCookie(cookieName);
  return cookie === "1";
}

export function resetOnboarding(cookieName = DEFAULT_COOKIE, storageKey = DEFAULT_STORAGE_KEY) {
  try {
    document.cookie = `${cookieName}=; Max-Age=0; Path=/`;
    localStorage.removeItem(storageKey);
  } catch {}
}

// -------------------------
// Main component
// -------------------------
export default function OnboardingCards({
  steps: stepsProp,
  fallbackSteps,
  forceShow,
  storageKey = DEFAULT_STORAGE_KEY,
  cookieName = DEFAULT_COOKIE,
  onComplete,
  onClose,
  brand,
}: OnboardingCardsProps) {
  // Ensure CSS is injected on mount (client-only)
  useEffect(() => {
    ensureOnboardingStyles();
  }, []);

  // Resolve steps (prop → fallback → built-in default)
  const { steps, usingFallback } = useMemo(
    () => resolveSteps(stepsProp, fallbackSteps),
    [stepsProp, fallbackSteps]
  );

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswer>({});
  const [ready, setReady] = useState(false);
  const current = steps[index];
  const isLast = index === steps.length - 1;

  // Force-show when we're in demo mode (using built-in fallback because no steps were provided)
  const forceDemo = usingFallback && stepsProp == null;
  const effectiveForce = Boolean(forceShow || forceDemo);

  // On mount: if cookie is already set, render nothing (unless forced)
  const [suppressed, setSuppressed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (shouldSuppress(effectiveForce, cookieName)) {
      setSuppressed(true);
      return; // don't load draft
    }
    const draft = loadDraft(storageKey);
    if (draft) {
      const clamped = clampIndexForSteps(draft.index, steps.length);
      setAnswers(draft.answers);
      setIndex(clamped);
    }
    setReady(true);
    if (steps.length > 0) track("onboarding_view", { step: steps[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveForce, cookieName, storageKey, steps.length]);

  useEffect(() => {
    if (!ready) return;
    saveDraft(storageKey, answers, index);
  }, [answers, index, ready, storageKey]);

  const canContinue = useMemo(() => {
    if (!current) return false;
    const val = answers[current.id];
    if (!current.required) return true;
    if (current.type === "text") {
      if (Array.isArray(val)) {
        const filled = val.filter((s) => typeof s === "string" && s.trim().length > 0);
        return filled.length > 0; // when required, need at least one entry
      }
      return !!val && String(val).trim().length > 0;
    }
    if (current.type === "range") return typeof val === "number";
    if (current.type === "single") return typeof val === "string" && val.length > 0;
    if (current.type === "multi") return Array.isArray(val) && val.length > 0;
    return false;
  }, [answers, current]);

  async function complete() {
    setClientCookie(cookieName, "1");
    clearDraft(storageKey);
    track("onboarding_complete", { answers });
    try {
      await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, completedAt: new Date().toISOString() }),
      });
    } catch {}
    try {
      await onComplete?.(answers);
    } finally {
      setDismissed(true);
      onClose?.();
    }
  }

  function next() {
    if (!current) return; // no-op if no steps
    if (isLast) return void complete();
    const nextIndex = clampIndexForSteps(index + 1, steps.length);
    setIndex(nextIndex);
    const to = steps[nextIndex];
    track("onboarding_step_next", { from: current.id, to: to?.id });
  }

  function back() {
    if (!current) return;
    const prevIndex = clampIndexForSteps(index - 1, steps.length);
    setIndex(prevIndex);
    const to = steps[prevIndex];
    track("onboarding_step_back", { from: current.id, to: to?.id });
  }

  function updateAnswer(stepId: string, value: any) {
    setAnswers((prev) => ({ ...prev, [stepId]: value }));
  }

  const DevNotice = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed bottom-4 left-4 z-[60] max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 shadow">{children}</div>
  );

  // If the user previously completed onboarding, suppress UI entirely
  if (suppressed) {
    if (isDebug()) {
      return (
        <DevNotice>
          Onboarding suppressed by cookie. Override by adding <code>?onboarding=1</code> to the URL,
          or pass the <code>forceShow</code> prop, or clear the <code>{cookieName}</code> cookie.
        </DevNotice>
      );
    }
    return null;
  }

  // If user finished this session, hide immediately
  if (dismissed) return null;

  // Defer hydration until draft/cookie check done
  if (!ready) return null;

  // If somehow we still have no steps (shouldn't happen), warn and render nothing
  if (!current) {
    if (isDebug()) {
      return (
        <DevNotice>
          No steps resolved for <code>&lt;OnboardingCards/&gt;</code>. Provide <code>steps</code> or <code>fallbackSteps</code>.
        </DevNotice>
      );
    }
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 kai-onboarding" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: '16px' }}>
      <div className="relative w-full max-w-2xl">
        <div className="rounded-2xl bg-white p-6 shadow-2xl" style={{ background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.18)' }}>
          <header className="mb-4 flex items-center gap-3">
            {
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand?.logoUrl ?? "/images/logo.png"}
                alt="Get Kinder"
                style={{ height: "100px", width: "150px", objectFit: "contain" }}
                className="rounded-sm"
              />
            }
            <div>
              <div className="text-xs font-medium text-[#455a7c]">Step {index + 1} of {steps.length}</div>
              <h2 className="mt-1 text-2xl font-semibold kai-title">{current.title}</h2>
              {current.description && (
                <p className="mt-1 text-sm text-[#455a7c]">{current.description}</p>
              )}
            </div>
          </header>

          <div className="min-h-[180px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.18 }}
              >
                <StepBody step={current} value={answers[current.id]} onChange={updateAnswer} />
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className="mt-6 kai-footer">
            <button
              onClick={back}
              disabled={index === 0}
              className="kai-btn kai-btn-outline"
            >Back</button>

            <div className="kai-actions">
              <button
                onClick={next}
                disabled={!canContinue}
                className={`kai-btn ${isLast ? "kai-btn-outline" : "kai-btn-primary"}`}
              >{isLast ? "Finish" : "Continue"}</button>
              {isLast && (
                <a
                  href="login"
                  className="kai-btn kai-btn-primary"
                  data-testid="login-button"
                >Log in</a>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

// -------------------------
// Step body renderer
// -------------------------
function StepBody({
  step,
  value,
  onChange,
}: {
  step: OnboardingStep;
  value: any;
  onChange: (id: string, value: any) => void;
}) {
  if (step.type === "single") {
    return (
      <div className="kai-grid grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label={step.title}>
        {step.options?.map((opt) => {
          const selected = value === opt.id;
          return (
            <label key={opt.id} className={`kai-card-option ${selected ? "is-selected" : ""}`}>
              <input
                type="radio"
                name={step.id}
                value={opt.id}
                checked={selected}
                onChange={() => onChange(step.id, opt.id)}
                className="sr-only"
              />
              <div className="text-sm font-medium text-[#455a7c]">{opt.label}</div>
              {opt.helper && <div className="mt-1 text-xs text-[#455a7c]">{opt.helper}</div>}
            </label>
          );
        })}
      </div>
    );
  }

  if (step.type === "multi") {
    const selected: string[] = Array.isArray(value) ? value : [];
    function toggle(id: string) {
      const set = new Set(selected);
      if (set.has(id)) set.delete(id); else set.add(id);
      onChange(step.id, Array.from(set));
    }
    return (
      <div className="kai-grid grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label={step.title}>
        {step.options?.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle(opt.id)}
            className={`kai-card-option ${selected.includes(opt.id) ? "is-selected" : ""}`}
            aria-pressed={selected.includes(opt.id)}
          >
            <div className="text-sm font-medium text-[#455a7c]">{opt.label}</div>
            {opt.helper && <div className="mt-1 text-xs text-[#455a7c]">{opt.helper}</div>}
          </button>
        ))}
      </div>
    );
  }

  if (step.type === "range") {
    const v = typeof value === "number" ? value : Math.round(((step.min ?? 0) + (step.max ?? 10)) / 2);
    return (
      <div>
        <input
          type="range"
          min={step.min ?? 0}
          max={step.max ?? 10}
          value={v}
          onChange={(e) => onChange(step.id, Number(e.target.value))}
          className="kai-range w-full"
          aria-label={step.title}
        />
        <div className="mt-2 text-sm text-[#455a7c]">{v}</div>
      </div>
    );
  }

  // text (supports single or multiple fields via `placeholder` or `placeholders`)
  if (Array.isArray(step.placeholders) && step.placeholders.length > 0) {
    const ph: string[] = step.placeholders;
    const arr: string[] = Array.isArray(value) ? value.slice(0, ph.length) : Array(ph.length).fill("");
    function setIdx(i: number, v: string) {
      const next = arr.slice();
      next[i] = v;
      onChange(step.id, next);
    }
    return (
      <div className="grid grid-cols-1 gap-3">
        {ph.map((p, i) => (
          <input
            key={`${step.id}-${i}`}
            type="text"
            value={typeof arr[i] === "string" ? arr[i] : ""}
            onChange={(e) => setIdx(i, e.target.value)}
            placeholder={p}
            className="kai-input w-full"
            aria-label={`${step.title} ${i + 1}`}
          />
        ))}
      </div>
    );
  }

  // default single-field text
  return (
    <div>
      <input
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(step.id, e.target.value)}
        placeholder={step.placeholder}
        className="kai-input w-full"
        aria-label={step.title}
      />
    </div>
  );
}

// -------------------------
// Demo config (remove in prod)
// -------------------------
export function DemoOnboarding() {
  const steps: OnboardingStep[] = getDefaultSteps();

  return (
    <OnboardingCards
      steps={steps}
      // You can remove forceShow below once you're done testing or rely on ?onboarding=1.
      forceShow
      brand={{ productName: "Get Kinder AI", logoUrl: "/logo.png" }}
      onComplete={(answers) => {
        track("demo_complete", answers as any);
        // router.push("/learn"); // example of navigation after completion
      }}
    />
  );
}

// -------------------------
// Lightweight tests (DEV-only)
// -------------------------
if (typeof window !== "undefined" && isDebug()) {
  function assert(name: string, condition: boolean) {
    if (!condition) {
      // eslint-disable-next-line no-console
      console.error(`OnboardingCards test failed: ${name}`);
    }
  }

  // Test normalizeSteps
  assert("normalizeSteps handles undefined", normalizeSteps(undefined).length === 0);
  assert(
    "normalizeSteps passes through array",
    normalizeSteps([{ id: "a", title: "t", type: "text" } as OnboardingStep]).length === 1
  );

  // Test clampIndexForSteps
  assert("clampIndexForSteps returns 0 when stepsLen=0", clampIndexForSteps(5, 0) === 0);
  assert("clampIndexForSteps clamps to last index", clampIndexForSteps(5, 3) === 2);
  assert("clampIndexForSteps clamps to 0 for negative", clampIndexForSteps(-3, 3) === 0);

  // Test resolveSteps (fallback path and provided steps)
  const r1 = resolveSteps(undefined, undefined);
  assert("resolveSteps falls back to default preset", r1.steps.length > 0 && r1.usingFallback === true);
  const r2 = resolveSteps([{ id: "x", title: "X", type: "text" } as OnboardingStep], []);
  assert("resolveSteps uses provided steps when present", r2.steps[0].id === "x" && r2.usingFallback === false);

  // Test that default steps include interests with 3 placeholders
  const defaults = getDefaultSteps();
  const interest = defaults.find((s) => s.id === "interests");
  assert("default interests step exists", !!interest);
  assert("interests step has 3 placeholders", Array.isArray(interest?.placeholders) && (interest?.placeholders?.length || 0) === 3);
  assert("default steps count is 6", defaults.length === 6);
  assert("6th step is 'age'", defaults[5].id === "age");

  // Test shouldSuppress / force logic: force=true should bypass cookie
  const hadCookie = getClientCookie("onboarding_done");
  setClientCookie("onboarding_done", "1");
  assert("shouldSuppress is false when effective force=true", shouldSuppress(true, "onboarding_done") === false);

  // Test resetOnboarding clears cookie & storage
  setClientCookie("onboarding_done", "1");
  localStorage.setItem(DEFAULT_STORAGE_KEY, "x");
  resetOnboarding();
  assert("resetOnboarding clears cookie", getClientCookie("onboarding_done") === null);
  assert("resetOnboarding clears draft", localStorage.getItem(DEFAULT_STORAGE_KEY) === null);

  // Restore prior cookie state if needed
  if (hadCookie) setClientCookie("onboarding_done", hadCookie);
}
