import React, { useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";

const LIKERT_LABELS = {
  1: "lol nope",
  2: "kinda rare",
  3: "eh, sometimes",
  4: "yeah, usually",
  5: "this is my whole personality",
};

const SKILL_ITEMS = [
  {
    group: "Initiation & Invitations",
    items: [
      { code: "initiation_start", label: "I’m the one who slides into DMs or texts first instead of always waiting to be summoned." },
      { code: "initiation_invites", label: "I regularly invite people to small things (walk, coffee, game night, FaceTime, Discord hang)." },
      { code: "initiation_newthings", label: "I’m the friend who’s like, “We should try ___” and actually sends a link / idea." },
    ],
  },
  {
    group: "Reliability & Boundaries",
    items: [
      { code: "reliability_followthrough", label: "If I say I’ll be somewhere or do something, I mostly follow through instead of last-minute disappearing." },
      { code: "reliability_sayno", label: "When I’m not up for plans, I can say no clearly and kindly instead of ghosting or making sketchy excuses." },
      { code: "reliability_respect_boundaries", label: "If a friend says they’re tired / broke / not feeling it, I don’t push—I respect that and drop the pressure." },
    ],
  },
  {
    group: "Responsiveness & Listening",
    items: [
      { code: "responsive_comfort", label: "When a friend drops something heavy, I send more than “dang that sucks”—I actually respond in a caring way." },
      { code: "responsive_followup", label: "I ask follow-up questions that show I was listening (not just “cool” and switching topics)." },
      { code: "responsive_remember", label: "I remember important stuff friends tell me and sometimes check back in about it." },
    ],
  },
  {
    group: "Vulnerability & Sharing Yourself",
    items: [
      { code: "vulnerability_letin", label: "At least a couple friends know what I’m actually going through this season, not just the highlight reel." },
      { code: "vulnerability_feelings", label: "I can say how I feel (“low-key anxious about X,” “weirdly proud of Y”) instead of only giving life updates." },
      { code: "vulnerability_repair", label: "If there’s tension or a weird vibe, I’m willing to bring it up gently instead of just fading out." },
    ],
  },
];

const TYPE_ITEMS = [
  { code: "type_vault", label: "Vault Friend", desc: "People vent to me and it stays locked." },
  { code: "type_anchor", label: "Human Weighted Blanket", desc: "Steady, on time, keeps rituals calm." },
  { code: "type_adventurer", label: "Chaos (But Fun) Adventurer", desc: "Down for new spots or “sure, why not” plans." },
  { code: "type_communicator", label: "Group Chat Mod", desc: "Translate vibes, clarify plans, keep chat smooth." },
  { code: "type_connector", label: "Social Router", desc: "Introduce friends, end up as social glue." },
  { code: "type_coach", label: "Hype Coach", desc: "Ask about goals, send “you got this,” give feedback when wanted." },
  { code: "type_collaborator", label: "Build-Something Buddy", desc: "Love making / learning things together." },
  { code: "type_caregiver", label: "Soft Care Friend", desc: "Notice when someone’s off, send “you good?” texts, small care." },
];

const TYPE_LABELS = TYPE_ITEMS.reduce((acc, t) => {
  acc[t.code] = t.label;
  return acc;
}, {});

function mean(values) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function band(score) {
  if (score >= 3.5) return "Big Strength";
  if (score >= 2.5) return "In Progress";
  return "Growth Edge";
}

function scoreMyFriendshipEnergy({ skillsRaw, typeRaw }) {
  const initiation = mean([
    skillsRaw.initiation_start,
    skillsRaw.initiation_invites,
    skillsRaw.initiation_newthings,
  ]);
  const reliability = mean([
    skillsRaw.reliability_followthrough,
    skillsRaw.reliability_sayno,
    skillsRaw.reliability_respect_boundaries,
  ]);
  const responsiveness = mean([
    skillsRaw.responsive_comfort,
    skillsRaw.responsive_followup,
    skillsRaw.responsive_remember,
  ]);
  const vulnerability = mean([
    skillsRaw.vulnerability_letin,
    skillsRaw.vulnerability_feelings,
    skillsRaw.vulnerability_repair,
  ]);

  const skills = {
    initiation: { score: initiation, band: band(initiation) },
    reliability: { score: reliability, band: band(reliability) },
    responsiveness: { score: responsiveness, band: band(responsiveness) },
    vulnerability: { score: vulnerability, band: band(vulnerability) },
  };

  const typeScores = Object.entries(typeRaw || {}).map(([code, score]) => ({
    code,
    score: Number(score) || 0,
  }));
  typeScores.sort((a, b) => b.score - a.score);
  const high = typeScores.filter((t) => t.score >= 3.5);
  let main = [];
  if (high.length === 0 && typeScores.length) {
    main = typeScores.slice(0, 1);
  } else if (high.length <= 2) {
    main = high;
  } else {
    main = high.slice(0, 2);
  }
  const secondary = typeScores.filter((t) => !main.find((m) => m.code === t.code)).slice(0, 3);
  main = main.map((t) => ({ ...t, label: TYPE_LABELS[t.code] || t.code }));
  const archetypes = {
    scores: typeScores.reduce((acc, t) => ({ ...acc, [t.code]: t.score }), {}),
    main,
    secondary: secondary.map((t) => ({ ...t, label: TYPE_LABELS[t.code] || t.code })),
  };

  const growthEdges = [];
  const strengths = [];
  Object.entries(skills).forEach(([k, v]) => {
    if (v.band === "Big Strength") strengths.push(k);
    if (v.band === "Growth Edge") growthEdges.push(k);
  });

  return {
    skills,
    archetypes,
    growthEdges,
    strengths,
    stuckTransitions: [],
  };
}

function LikertRow({ code, label, value, onChange }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-700">{label}</div>
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(code, n)}
            className={`h-12 rounded-xl border text-sm font-medium transition ${
              value === n
                ? "bg-[#455a7c] text-white border-[#455a7c]"
                : "bg-white hover:bg-[#455a7c]/5 border-slate-200"
            }`}
            title={LIKERT_LABELS[n]}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="text-xs text-slate-500">Scale: 1 = “lol nope” · 5 = “this is my whole personality”</div>
    </div>
  );
}

export default function MyFriendshipEnergyQuiz({ userId, onScore, onAfterResult }) {
  const [skillsRaw, setSkillsRaw] = useState(
    SKILL_ITEMS.flatMap((g) => g.items).reduce((acc, i) => ({ ...acc, [i.code]: null }), {})
  );
  const [types, setTypes] = useState(TYPE_ITEMS.reduce((acc, t) => ({ ...acc, [t.code]: null }), {}));
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [errors, setErrors] = useState([]);
  const [showCelebrate, setShowCelebrate] = useState(false);

  useEffect(() => {
    if (!showCelebrate) return;
    try {
      confetti({ particleCount: 160, spread: 70, origin: { y: 0.6 } });
    } catch (e) {
      console.warn("confetti failed", e);
    }
  }, [showCelebrate]);

  const completion = useMemo(() => {
    const skillAnswered = Object.values(skillsRaw).filter((v) => Number.isFinite(v)).length;
    const typeAnswered = Object.values(types).filter((v) => Number.isFinite(v)).length;
    return {
      skills: skillAnswered / Object.keys(skillsRaw).length,
      types: typeAnswered / Object.keys(types).length,
    };
  }, [skillsRaw, types]);

  const validate = () => {
    const errs = [];
    if (completion.skills < 1) errs.push("Answer all skill questions.");
    if (completion.types < 1) errs.push("Answer all friendship energy questions.");
    return errs;
  };

  const handleScore = () => {
    const errs = validate();
    if (errs.length) {
      setErrors(errs);
      return null;
    }
    setErrors([]);
    const scored = scoreMyFriendshipEnergy({
      skillsRaw,
      typeRaw: types,
    });
    setResult(scored);
    onScore?.(scored);
    onAfterResult?.();
    return scored;
  };

  const readCsrf = () => {
    const meta = typeof document !== "undefined" ? document.querySelector('meta[name="csrf-token"]') : null;
    return meta ? meta.getAttribute("content") : null;
  };

  const handleSave = async () => {
    let scored = result;
    if (!scored) {
      scored = handleScore();
      if (!scored) return;
    }
    if (!userId) {
      setStatus({ state: "error", message: "Please sign in to save your results." });
      return;
    }
    const csrf = readCsrf();
    if (!csrf) {
      setStatus({ state: "error", message: "Missing CSRF token." });
      return;
    }
    try {
      setStatus({ state: "saving", message: "Saving..." });
      const payload = {
        answers: {
          skills: skillsRaw,
          types,
        },
        skills: scored.skills,
        archetypes: scored.archetypes,
        ladderSnapshot: {},
        growthEdges: scored.growthEdges,
        strengths: scored.strengths,
        stuckTransitions: scored.stuckTransitions,
        completedAt: new Date().toISOString(),
      };
      const res = await fetch("/api/friendship-energy", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Save failed (${res.status})`);
      }
      setStatus({ state: "saved", message: "Saved ✓" });
      onAfterResult?.();
      setTimeout(() => setShowCelebrate(true), 300);
    } catch (e) {
      setStatus({ state: "error", message: e.message || "Save failed" });
    }
  };

  const setSkill = (code, value) => setSkillsRaw((prev) => ({ ...prev, [code]: value }));
  const setType = (code, value) => setTypes((prev) => ({ ...prev, [code]: value }));
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
        <div className="text-sm text-[#455a7c]">
          This quiz is about <strong>you</strong>, not any one friend. Think about the last 2–3 months. For each line, slide from “lol nope” → “big yes” to show how true it feels.
        </div>
      </div>

      {showCelebrate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl border border-slate-100">
            <div className="text-3xl mb-2">🎉</div>
            <h2 className="text-2xl font-bold text-[#455a7c]">Saved!</h2>
            <p className="mt-2 text-sm text-[#455a7c]">
              Your Friendship Energy quiz was saved. Keep building those superpowers!
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setShowCelebrate(false)}
                className="flex-1 rounded-2xl border border-[#455a7c] px-4 py-2 text-[#455a7c] font-semibold hover:bg-[#455a7c]/5"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setShowCelebrate(false)}
                className="flex-1 rounded-2xl bg-[#ff5656] px-4 py-2 font-semibold text-white shadow hover:bg-[#ff5656]/90"
              >
                Great!
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-[#455a7c]">Skills (1–5)</div>
          <div className="text-xs text-slate-600">1 = “lol nope” · 5 = “this is my whole personality”</div>
        </div>
        <div className="space-y-4">
          {SKILL_ITEMS.map((group) => (
            <div key={group.group} className="space-y-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">{group.group}</div>
              {group.items.map((item) => (
                <LikertRow
                  key={item.code}
                  code={item.code}
                  label={item.label}
                  value={skillsRaw[item.code]}
                  onChange={setSkill}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-[#455a7c]">Friendship energy you bring (1–5)</div>
          <div className="text-xs text-slate-600">How often is this you?</div>
        </div>
        <div className="space-y-3">
          {TYPE_ITEMS.map((item) => (
            <LikertRow
              key={item.code}
              code={item.code}
              label={`${item.label} — ${item.desc}`}
              value={types[item.code]}
              onChange={setType}
            />
          ))}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm">
          <ul className="list-disc list-inside space-y-1">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleScore}
          className="px-4 py-2 rounded-xl border border-[#455a7c] text-[#455a7c] font-semibold hover:bg-[#455a7c]/5"
        >
          See results
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={status.state === "saving"}
          className={`px-4 py-2 rounded-xl text-white font-semibold shadow ${
            status.state === "saving"
              ? "bg-[#455a7c]/60 cursor-not-allowed"
              : "bg-[#ff5656] hover:bg-[#ff5656]/90"
          }`}
        >
          {status.state === "saving" ? "Saving…" : "Save"}
        </button>
        {status.message && (
          <span
            className={`text-sm ${
              status.state === "error" ? "text-rose-600" : "text-[#455a7c]"
            }`}
          >
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
