import React, { useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";

const NEED_OPTIONS = [
  { code: "heart_to_heart", label: "Heart-to-Heart Friend", desc: "Deep talks, real feelings, late-night brain dumps." },
  { code: "low_drama_rock", label: "Low-Drama Rock", desc: "Chill routines, someone steady, low chaos." },
  { code: "adventure_buddy", label: "Adventure Buddy", desc: "New spots, fun plans, “say yes” energy." },
  { code: "group_chat_ceo", label: "Group Chat CEO", desc: "Planner friend, group glue, makes hangs happen." },
  { code: "glow_up_partner", label: "Glow-Up Partner", desc: "Goals, feedback, “let’s level up together.”" },
];

const RED_FLAG_OPTIONS = [
  { code: "chronic_flakiness", label: "Chronic flakiness", desc: "Often cancels last minute or doesn’t show." },
  { code: "putdowns_disrespect", label: "Put-downs / disrespect", desc: "Jokes or comments that land mean, not playful." },
  { code: "gossip_bonding", label: "Gossip bonding", desc: "Regularly talks trash to connect." },
  { code: "breaches_confidence", label: "Breaches confidence", desc: "Shares what you wanted kept private." },
  { code: "ignores_boundaries", label: "Ignores boundaries", desc: "Keeps pushing after you say you’re not okay with something." },
];

const CLOSENESS_ITEMS = [
  { code: "contact_freq", label: "We text / DM / talk in person pretty much every week." },
  { code: "contact_overlap", label: "Our lives cross naturally (same school/work/group/server/gym/etc.)." },
  { code: "mutual_initiation", label: "They hit me up or start plans sometimes. It’s not 100% me doing the reaching out." },
  { code: "mutual_response", label: "When I message, they respond in a timeframe that feels normal for them." },
  { code: "plan_energy", label: "In the last month, they’ve suggested hanging out again or floated a specific idea." },
  { code: "self_disclosure_me", label: "I’ve told them at least one real thing I’m stressed about or insecure about this season." },
  { code: "self_disclosure_them", label: "They’ve shared something personal with me (not just “work is busy” small talk)." },
  { code: "emotional_safety", label: "When we talk about deeper stuff, I feel pretty safe—like they get it and aren’t judging." },
  { code: "support_showup", label: "When I’ve needed a small favor or emotional check-in, they mostly showed up." },
  { code: "support_followthrough", label: "If they say they’ll call, pull up, or bring something, they usually actually do it." },
  { code: "shared_recent", label: "In the last month, we’ve done at least one fun or meaningful thing together." },
  { code: "shared_future", label: "We’ve got at least one plan, event, or repeating thing coming up together." },
  { code: "global_trust", label: "If I really needed help with something important, I’d feel okay asking them." },
];

const TYPE_ITEMS = [
  { code: "type_vault", label: "Vault Friend", desc: "“Tell me everything” friend; secrets stay locked." },
  { code: "type_anchor", label: "Human Weighted Blanket", desc: "Steady, calm, shows up." },
  { code: "type_adventurer", label: "Chaos (But Fun) Adventurer", desc: "Down for new spots / plans." },
  { code: "type_communicator", label: "Group Chat Mod", desc: "Clarifies plans, smooths misreads." },
  { code: "type_connector", label: "Social Router", desc: "Introduces people, merges friend groups." },
  { code: "type_coach", label: "Hype Coach", desc: "Supports goals, feedback when asked." },
  { code: "type_collaborator", label: "Build-Something Buddy", desc: "Loves making / learning together." },
  { code: "type_caregiver", label: "Soft Care Friend", desc: "Notices when you’re off, little gestures." },
];

const LIKERT_LABELS = {
  1: "lol nope",
  2: "kinda rare",
  3: "eh, sometimes",
  4: "mostly yeah",
  5: "big yes",
};

const TYPE_LABELS = TYPE_ITEMS.reduce((acc, item) => {
  acc[item.code] = item.label;
  return acc;
}, {});
const TYPE_CANONICAL = {
  type_vault: "Confidante",
  type_anchor: "Anchor",
  type_adventurer: "Adventurer",
  type_communicator: "Communicator",
  type_connector: "Connector",
  type_coach: "Coach",
  type_collaborator: "Collaborator",
  type_caregiver: "Caregiver",
};
const ALLOWED_ARCHETYPES = new Set(Object.values(TYPE_CANONICAL));

function mean(values) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function scoreFriendCheck({ need, redFlags, closeness, types }) {
  const redflagKeys = Object.keys(redFlags || {}).filter((k) => redFlags[k]);
  const redflag_total = redflagKeys.length;

  const subscales = {
    Contact: mean([closeness.contact_freq, closeness.contact_overlap]),
    Mutual_Interest: mean([
      closeness.mutual_initiation,
      closeness.mutual_response,
      closeness.plan_energy,
    ]),
    Disclosure_Safety: mean([
      closeness.self_disclosure_me,
      closeness.self_disclosure_them,
      closeness.emotional_safety,
    ]),
    Support_Reliability: mean([closeness.support_showup, closeness.support_followthrough]),
    Shared_Experiences: mean([closeness.shared_recent, closeness.shared_future]),
    Trust: closeness.global_trust ?? 0,
  };

  const warnings = [];
  let unsafeToDeepen = false;
  let hasCautionFlags = false;
  if (redflag_total >= 3) {
    unsafeToDeepen = true;
    warnings.push(
      "Even if parts feel close, repeated patterns like disrespect or breached boundaries make it risky to invest more."
    );
  } else if (redflag_total >= 1) {
    hasCautionFlags = true;
    warnings.push("There are a couple of caution flags. Pace yourself and add boundaries.");
  }

  const {
    Contact,
    Mutual_Interest,
    Disclosure_Safety,
    Support_Reliability,
    Shared_Experiences,
    Trust,
  } = subscales;

  const bestConditions =
    Contact >= 3.7 &&
    Mutual_Interest >= 3.7 &&
    Disclosure_Safety >= 4.3 &&
    Support_Reliability >= 4.3 &&
    Shared_Experiences >= 3.7 &&
    Trust >= 4.5;

  const closeConditions =
    Contact >= 3.7 &&
    Mutual_Interest >= 3.7 &&
    Disclosure_Safety >= 3.7 &&
    Support_Reliability >= 3.7 &&
    Shared_Experiences >= 3.7 &&
    Trust >= 3.7;

  const friendConditions =
    Contact >= 3.0 &&
    Mutual_Interest >= 3.0 &&
    Disclosure_Safety >= 3.0 &&
    Support_Reliability >= 3.0 &&
    Shared_Experiences >= 3.0 &&
    Trust >= 3.0;

  const casualConditions =
    Contact >= 2.5 &&
    Mutual_Interest >= 2.5 &&
    Trust >= 2.5 &&
    Math.max(Disclosure_Safety, Support_Reliability, Shared_Experiences) >= 3.0;

  let levelCode = "acquaintance";
  if (bestConditions) {
    levelCode = "best_friend";
  } else if (closeConditions) {
    levelCode = "close_friend";
  } else if (friendConditions) {
    levelCode = "friend";
  } else if (casualConditions) {
    levelCode = "casual_friend";
  } else if (
    Contact < 2.5 ||
    (Mutual_Interest < 2.5 && Shared_Experiences < 2.5)
  ) {
    levelCode = "acquaintance";
  } else {
    levelCode = "casual_friend";
  }

  const levelLabelMap = {
    acquaintance: "Acquaintance",
    casual_friend: "Casual Friend",
    friend: "Friend",
    close_friend: "Close Friend",
    best_friend: "Best Friend",
  };

  const typeScores = Object.entries(types || {}).map(([code, score]) => ({
    code,
    score: Number(score) || 0,
  }));
  typeScores.sort((a, b) => b.score - a.score);
  const highTypes = typeScores.filter((t) => t.score >= 3.5);
  let topTypes = [];
  if (highTypes.length === 0 && typeScores.length) {
    topTypes = typeScores.slice(0, 1);
  } else if (highTypes.length <= 2) {
    topTypes = highTypes;
  } else {
    topTypes = highTypes.slice(0, 2);
  }
  topTypes = topTypes.map((t) => ({ ...t, label: TYPE_LABELS[t.code] || t.code }));

  const overallScore = mean([
    subscales.Contact,
    subscales.Mutual_Interest,
    subscales.Disclosure_Safety,
    subscales.Support_Reliability,
    subscales.Shared_Experiences,
    subscales.Trust,
  ]);

  return {
    levelCode,
    levelLabel: levelLabelMap[levelCode] || "Friend",
    subscales,
    redflag_total,
    warnings,
    unsafeToDeepen,
    hasCautionFlags,
    topTypes,
    overallScore: Math.round(overallScore * 20), // 0-100-ish
    need,
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
      <div className="text-xs text-slate-500">Scale: 1 = “lol nope” · 5 = “big yes”</div>
    </div>
  );
}

export default function FriendCheckQuiz({ userId, onScore, onAfterResult }) {
  const [friendName, setFriendName] = useState("");
  const [need, setNeed] = useState(null);
  const [redFlags, setRedFlags] = useState(
    RED_FLAG_OPTIONS.reduce((acc, r) => ({ ...acc, [r.code]: false }), {})
  );
  const [closeness, setCloseness] = useState(
    CLOSENESS_ITEMS.reduce((acc, r) => ({ ...acc, [r.code]: null }), {})
  );
  const [types, setTypes] = useState(TYPE_ITEMS.reduce((acc, r) => ({ ...acc, [r.code]: null }), {}));
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
    const closenessAnswered = Object.values(closeness).filter((v) => Number.isFinite(v)).length;
    const typeAnswered = Object.values(types).filter((v) => Number.isFinite(v)).length;
    return {
      closeness: closenessAnswered / CLOSENESS_ITEMS.length,
      types: typeAnswered / TYPE_ITEMS.length,
    };
  }, [closeness, types]);

  const validationErrors = useMemo(() => {
    const errs = [];
    if (!need) errs.push("Pick what kind of friend you’re craving right now.");
    if (completion.closeness < 1) errs.push("Answer all closeness questions.");
    if (completion.types < 1) errs.push("Answer all friend-type questions.");
    return errs;
  }, [need, completion]);

  const handleScore = () => {
    if (validationErrors.length) {
      setErrors(validationErrors);
      return null;
    }
    setErrors([]);
    const scored = scoreFriendCheck({ need, redFlags, closeness, types });
    setResult(scored);
    onScore?.(scored);
    onAfterResult?.();
    return scored;
  };

  const setClosenessValue = (code, value) => {
    setCloseness((prev) => ({ ...prev, [code]: value }));
  };
  const setTypeValue = (code, value) => {
    setTypes((prev) => ({ ...prev, [code]: value }));
  };
  const toggleFlag = (code) => {
    setRedFlags((prev) => ({ ...prev, [code]: !prev[code] }));
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
      const redFlagList = Object.entries(redFlags)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const primaryCanonical = scored.topTypes[0]?.code
        ? TYPE_CANONICAL[scored.topTypes[0].code] || null
        : null;
      const secondaryCanonical = scored.topTypes[1]?.code
        ? TYPE_CANONICAL[scored.topTypes[1].code] || null
        : null;
      const payload = {
        name: friendName?.trim() || "Friend",
        score: scored.overallScore,
        archetype_primary: ALLOWED_ARCHETYPES.has(primaryCanonical) ? primaryCanonical : null,
        archetype_secondary: ALLOWED_ARCHETYPES.has(secondaryCanonical) ? secondaryCanonical : null,
        evidence_direct: 1,
        evidence_proxy: 0,
        flags_count: scored.redflag_total,
        red_flags: redFlagList,
        snapshot: { need, redFlags, closeness, types, level: scored.levelCode },
        tier: scored.levelLabel,
        channel_pref: "mixed",
      };

      const res = await fetch("/api/friends", {
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

      const friendId = json.id;
      if (friendId) {
        try {
          await fetch("/internal/quiz/completed", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              user_id: userId,
              friend_id: friendId,
              friend_name: payload.name,
              tier: scored.levelLabel,
              channel_pref: "mixed",
            }),
          });
        } catch (e) {
          console.warn("quiz/completed failed", e);
        }
      }

      setStatus({ state: "saved", message: "Saved ✓" });
      onAfterResult?.();
      setTimeout(() => setShowCelebrate(true), 300);
    } catch (e) {
      setStatus({ state: "error", message: e.message || "Save failed" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
        <label className="block text-sm font-semibold text-[#455a7c]">
          Friend name / nickname (optional)
          <input
            type="text"
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#455a7c]"
            placeholder="e.g., Sam from work"
          />
        </label>
      </div>

      {showCelebrate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl border border-slate-100">
            <div className="text-3xl mb-2">🎉</div>
            <h2 className="text-2xl font-bold text-[#455a7c]">Saved!</h2>
            <p className="mt-2 text-sm text-[#455a7c]">
              Your Friend Check was saved. Check your Friend Arc for next steps.
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
                onClick={() => {
                  setShowCelebrate(false);
                  if (typeof window !== "undefined") {
                    window.location.assign("/dashboard");
                  }
                }}
                className="flex-1 rounded-2xl bg-[#ff5656] px-4 py-2 font-semibold text-white shadow hover:bg-[#ff5656]/90"
              >
                View Friend Arc
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
        <div className="text-sm font-semibold text-[#455a7c]">
          What kind of friend are you craving right now?
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {NEED_OPTIONS.map((opt) => {
            const active = need === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => setNeed(opt.code)}
                className={`text-left rounded-2xl border p-3 transition ${
                  active
                    ? "border-[#ff5656] bg-[#ff5656]/10 shadow-sm"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="font-semibold text-sm">{opt.label}</div>
                <div className="text-xs text-slate-600 mt-1">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-3">
        <div className="text-sm font-semibold text-[#455a7c]">Red Flag Bingo</div>
        <div className="text-xs text-slate-600">
          Check anything that’s been a real pattern in the last few months.
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {RED_FLAG_OPTIONS.map((opt) => (
            <label
              key={opt.code}
              className={`flex items-start gap-2 rounded-xl border p-3 text-sm cursor-pointer ${
                redFlags[opt.code]
                  ? "border-rose-300 bg-rose-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <input
                type="checkbox"
                className="mt-1 accent-rose-500"
                checked={!!redFlags[opt.code]}
                onChange={() => toggleFlag(opt.code)}
              />
              <div>
                <div className="font-semibold">{opt.label}</div>
                <div className="text-xs text-slate-600">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-[#455a7c]">Closeness (last 2–3 months)</div>
          <div className="text-xs text-slate-600">1 = “lol nope” · 5 = “big yes”</div>
        </div>
        <div className="space-y-3">
          {CLOSENESS_ITEMS.map((item) => (
            <LikertRow
              key={item.code}
              code={item.code}
              label={item.label}
              value={closeness[item.code]}
              onChange={setClosenessValue}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-[#455a7c]">
            Friend energy they bring (1–5)
          </div>
          <div className="text-xs text-slate-600">How often do they show this?</div>
        </div>
        <div className="space-y-3">
          {TYPE_ITEMS.map((item) => (
            <LikertRow
              key={item.code}
              code={item.code}
              label={`${item.label} — ${item.desc}`}
              value={types[item.code]}
              onChange={setTypeValue}
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
