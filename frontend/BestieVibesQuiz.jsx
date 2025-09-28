// Bestie Vibes — Gen Z Friendship Quiz (Interactive)
// Tailwind styling, single-file React component. No external deps.
// New: "Signals Round" for low-context assessments, Unknown option, proxy scoring, and evidence meter.
// Rounds: Signals, Vibes, Adulting, Values, Archetype + Red-Flag Bingo. Save multiple candidates.

import { useMemo, useState, useRef, useEffect } from 'react'
import confetti from 'canvas-confetti'

// ---------- Config ----------
const WEIGHTS = {
  reliability: 3,
  values: 3,
  safety: 3,
  reciprocity: 2,
  chemistry: 2,
  interaction: 2,
  logistics: 2,
  activity: 1,
}

// When a core field is unknown, we use a proxy from Signals Round at this fraction of weight
const DEFAULT_PROXY_FRACTION = 0.45 // 45% credit for thin-slice evidence

const DEFAULT_ANSWERS = {
  // Core fields (set to null for low-info start)
  reliability: null,
  values: null,
  safety: null,
  reciprocity: null,
  chemistry: null,
  interaction: null,
  logistics: null,
  activity: null,
  // Archetype Round (neutral by default)
  arch_confidante: null,
  arch_anchor: null,
  arch_adventurer: null,
  arch_communicator: null,
  arch_connector: null,
  arch_coach: null,
  arch_collaborator: null,
  arch_caregiver: null,
  // Signals Round (first-encounter cues)
  sig_asks: null,        // asks Qs & listens
  sig_on_time: null,     // punctual / replies within a day
  sig_makes_plan: null,  // suggests next hang / chooses spot
  sig_includes: null,    // kind to staff, includes others
  sig_boundaries: null,  // respects small boundaries
  sig_energy: null,      // humor/pace match
}

const QUESTIONS = [
  // Signals Round — designed for low-context, first 1–2 hangs
  { id: 'sig_asks', round: 'Signals Round', emoji: '🗣️', title: 'Asks & listens', hint: 'They ask follow-ups and actually listen.' },
  { id: 'sig_on_time', round: 'Signals Round', emoji: '⏰', title: 'On-time / responsive', hint: 'Shows up on time; replies in ~24h.' },
  { id: 'sig_makes_plan', round: 'Signals Round', emoji: '📅', title: 'Plan energy', hint: 'Suggests a next hang or picks a spot.' },
  { id: 'sig_includes', round: 'Signals Round', emoji: '🤗', title: 'Inclusive kindness', hint: 'Kind to staff; brings people in.' },
  { id: 'sig_boundaries', round: 'Signals Round', emoji: '🛑', title: 'Boundary respect', hint: 'Honors pace/topics when you hint.' },
  { id: 'sig_energy', round: 'Signals Round', emoji: '⚡', title: 'Energy match', hint: 'Pace & humor feel aligned.' },

  // Vibes Round
  { id: 'chemistry', round: 'Vibes Round', emoji: '✨', title: 'Chemistry / Fun', hint: 'Do we laugh easily & want to hang?', weightKey: 'chemistry' },
  { id: 'interaction', round: 'Vibes Round', emoji: '📱', title: 'Interaction Fit', hint: 'Texting style, frequency, conflict vibes match?', weightKey: 'interaction' },

  // Adulting Round
  { id: 'reliability', round: 'Adulting Round', emoji: '📅', title: 'Reliability', hint: 'They keep plans & follow through', weightKey: 'reliability' },
  { id: 'reciprocity', round: 'Adulting Round', emoji: '🔁', title: 'Reciprocity', hint: 'Effort & invites are mutual', weightKey: 'reciprocity' },
  { id: 'logistics', round: 'Adulting Round', emoji: '🗺️', title: 'Logistics Fit', hint: 'Proximity + time overlap works', weightKey: 'logistics' },

  // Values Round
  { id: 'values', round: 'Values Round', emoji: '🧭', title: 'Values Match', hint: 'Top-3 traits line up', weightKey: 'values' },
  { id: 'safety', round: 'Values Round', emoji: '🛟', title: 'Emotional Safety', hint: 'I feel seen, respected, not judged', weightKey: 'safety' },
  { id: 'activity', round: 'Values Round', emoji: '🎳', title: 'Activity Overlap', hint: 'We have ≥1 regular thing to do', weightKey: 'activity' },

  // Archetype Round (ID only; doesn’t alter score, lightly nudges type)
  { id: 'arch_confidante', round: 'Archetype Round', emoji: '🫶', title: 'Confidante energy', hint: 'Shares honestly, listens, keeps confidence.' },
  { id: 'arch_anchor', round: 'Archetype Round', emoji: '🧱', title: 'Anchor energy', hint: 'Shows up on time, loves routines & traditions.' },
  { id: 'arch_adventurer', round: 'Archetype Round', emoji: '🧗', title: 'Adventurer energy', hint: 'Suggests new spots, down for novelty.' },
  { id: 'arch_communicator', round: 'Archetype Round', emoji: '📣', title: 'Communicator energy', hint: 'Smooth plans, repairs bumps fast.' },
  { id: 'arch_connector', round: 'Archetype Round', emoji: '🤝', title: 'Connector energy', hint: 'Introduces people, builds group hangs.' },
  { id: 'arch_coach', round: 'Archetype Round', emoji: '📈', title: 'Coach energy', hint: 'Accountability, hype, thoughtful feedback.' },
  { id: 'arch_collaborator', round: 'Archetype Round', emoji: '🎨', title: 'Collaborator energy', hint: 'Loves making/learning together.' },
  { id: 'arch_caregiver', round: 'Archetype Round', emoji: '🩹', title: 'Caregiver energy', hint: 'Warm check-ins, supportive, brings soup vibes.' },
]

const ROUNDS = ['Signals Round', 'Vibes Round', 'Adulting Round', 'Values Round', 'Archetype Round']

const DEALBREAKERS = [
  { id: 'flake', label: 'Chronic flakiness', emoji: '🙈' },
  { id: 'mean', label: 'Put-downs / disrespect', emoji: '😬' },
  { id: 'gossip', label: 'Gossip as a bonding strategy', emoji: '🗣️' },
  { id: 'trust', label: 'Breaches confidence', emoji: '🔓' },
  { id: 'boundary', label: 'Ignores boundaries (after told)', emoji: '🚩' },
]

function tierFromScore(score, evidence) {
  // If evidence is thin, be conservative with tier naming
  if (evidence.direct < 0.35) return { name: 'Provisional • Low Evidence', color: 'bg-gray-400', emoji: '🕵️' }
  if (score >= 85) return { name: 'Bestie Material', color: 'bg-green-500', emoji: '🏆' }
  if (score >= 70) return { name: 'Strong Contender', color: 'bg-emerald-400', emoji: '💎' }
  if (score >= 50) return { name: 'Potential Pal', color: 'bg-yellow-400', emoji: '🌟' }
  return { name: 'Acquaintance Energy', color: 'bg-gray-400', emoji: '🌤️' }
}

// Archetype system (8 cores)
const ARCHETYPE_MAP = {
  Confidante: { desc: 'deep talks, safe space, honesty', emoji: '🫶' },
  Anchor: { desc: 'routines, consistency, show-up energy', emoji: '🧱' },
  Adventurer: { desc: 'fun missions, novelty, momentum', emoji: '🧗' },
  Communicator: { desc: 'matched pace, smooth plans & repair', emoji: '📣' },
  Connector: { desc: 'brings people together, social bridge', emoji: '🤝' },
  Coach: { desc: 'accountability + growth buddy', emoji: '📈' },
  Collaborator: { desc: 'make/learn things together', emoji: '🎨' },
  Caregiver: { desc: 'empathy, caretaking, steady support', emoji: '🩹' },
}

// Helpers
const s = (v) => (v ?? 3) - 3 // -2..+2 centered
const clamp = (x, min, max) => Math.max(min, Math.min(max, x))

function proxyForField(field, a) {
  // Map first-meet signals → small offsets around neutral 3 (±1 max)
  let offset = 0
  switch (field) {
    case 'reliability':
      offset = 0.6 * s(a.sig_on_time) + 0.2 * s(a.sig_makes_plan)
      break
    case 'values':
      offset = 0.4 * s(a.sig_includes) + 0.3 * s(a.sig_asks) + 0.3 * s(a.sig_boundaries)
      break
    case 'safety':
      offset = 0.6 * s(a.sig_boundaries) + 0.3 * s(a.sig_asks)
      break
    case 'reciprocity':
      offset = 0.6 * s(a.sig_makes_plan) + 0.3 * s(a.sig_asks)
      break
    case 'chemistry':
      offset = 0.8 * s(a.sig_energy)
      break
    case 'interaction':
      offset = 0.5 * s(a.sig_on_time) + 0.4 * s(a.sig_energy)
      break
    case 'logistics':
      offset = 0.8 * s(a.sig_on_time)
      break
    case 'activity':
      offset = 0.8 * s(a.sig_makes_plan)
      break
    default:
      offset = 0
  }
  // Convert -2..+2 blend to ±1 range and center at 3
  const prox = 3 + clamp(offset / 2, -1, 1)
  return clamp(prox, 1, 5)
}

// Convert 1–5 answer to -2..+2 boost for archetype nudge
const toBoost = (v) => (v ?? 3) - 3

function scoresForArchetypes(a) {
  const base = {
    Confidante: (a.values ?? proxyForField('values', a)) + (a.safety ?? proxyForField('safety', a)),
    Anchor: (a.reliability ?? proxyForField('reliability', a)) + (a.logistics ?? proxyForField('logistics', a)),
    Adventurer: (a.chemistry ?? proxyForField('chemistry', a)) + (a.activity ?? proxyForField('activity', a)),
    Communicator: (a.interaction ?? proxyForField('interaction', a)) + (a.reciprocity ?? proxyForField('reciprocity', a)),
    Connector: (a.interaction ?? proxyForField('interaction', a)) + (a.activity ?? proxyForField('activity', a)),
    Coach: (a.values ?? proxyForField('values', a)) + (a.reciprocity ?? proxyForField('reciprocity', a)),
    Collaborator: (a.activity ?? proxyForField('activity', a)) + (a.values ?? proxyForField('values', a)),
    Caregiver: (a.safety ?? proxyForField('safety', a)) + (a.reciprocity ?? proxyForField('reciprocity', a)),
  }
  // Lightly blend in explicit archetype quiz signals (max ±2 each)
  const boosted = {
    Confidante: base.Confidante + toBoost(a.arch_confidante),
    Anchor: base.Anchor + toBoost(a.arch_anchor),
    Adventurer: base.Adventurer + toBoost(a.arch_adventurer),
    Communicator: base.Communicator + toBoost(a.arch_communicator),
    Connector: base.Connector + toBoost(a.arch_connector),
    Coach: base.Coach + toBoost(a.arch_coach),
    Collaborator: base.Collaborator + toBoost(a.arch_collaborator),
    Caregiver: base.Caregiver + toBoost(a.arch_caregiver),
  }
  return boosted
}

function topArchetypesFromAnswers(a) {
  const scores = scoresForArchetypes(a)
  return Object.entries(scores)
    .sort((x, y) => y[1] - x[1])
    .map(([name, score]) => ({ name, score, ...ARCHETYPE_MAP[name] }))
}

function evidenceBreakdown(a, weights, proxyFraction) {
  const keys = Object.keys(weights)
  let directW = 0, proxyW = 0, totalW = 0
  for (const k of keys) {
    const w = weights[k]
    totalW += w
    if (a[k] != null) directW += w
    else proxyW += w * proxyFraction
  }
  return {
    direct: totalW ? directW / totalW : 0,
    proxy: totalW ? proxyW / totalW : 0,
    total: totalW ? (directW + proxyW) / totalW : 0,
    directW, proxyW, totalW,
  }
}

function nextTests(a, weights) {
  // Recommend 3 evidence-building micro-tests for highest-weight unknowns
  const ideas = {
    reliability: 'Set a small plan with a time window; see if they confirm & show on time.',
    values: 'Ask: “What’s something you’re trying to get better at this season?”',
    safety: 'Share a medium-vulnerable story; notice curiosity & non-judgment.',
    reciprocity: 'Ask them to pick the spot/time for the next hang.',
    chemistry: 'Do a 30‑min game/creative mini-activity and notice ease & laughs.',
    interaction: 'Try voice notes / set texting expectations for a day and see the flow.',
    logistics: 'Offer two realistic time slots next week; see if scheduling is smooth.',
    activity: 'Propose a repeating anchor (Thu walk / Sun coffee).',
  }
  const unknowns = Object.entries(weights)
    .filter(([k]) => a[k] == null)
    .sort(([,wa], [,wb]) => wb - wa)
    .map(([k]) => ({ k, tip: ideas[k] }))
  return unknowns.slice(0, 3)
}

export default function BestieVibesQuiz(props = {}) {
  const { onSave } = props
  const [weights, setWeights] = useState({ ...WEIGHTS })
  const [proxyFraction, setProxyFraction] = useState(DEFAULT_PROXY_FRACTION)
  const [isAdminMode] = useState(() => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('admin')))
  const [showConfig, setShowConfig] = useState(false)
  const [candidateName, setCandidateName] = useState('')
  const [answers, setAnswers] = useState({ ...DEFAULT_ANSWERS })
  const [roundIndex, setRoundIndex] = useState(0)
  const [flags, setFlags] = useState({})
  const [saved, setSaved] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [pictureData, setPictureData] = useState(null)
  const camInputRef = useRef(null)
  const fileInputRef = useRef(null)

  // Load config & draft on mount
  useEffect(() => {
    try {
      const cfg = JSON.parse(localStorage.getItem('bestie_config') || 'null')
      if (cfg) {
        if (cfg.weights) setWeights((prev) => ({ ...prev, ...cfg.weights }))
        if (typeof cfg.proxyFraction === 'number') setProxyFraction(cfg.proxyFraction)
      }
      const draft = JSON.parse(localStorage.getItem('bestie_quiz_draft') || 'null')
      if (draft) {
        setCandidateName(draft.candidateName || '')
        setAnswers({ ...DEFAULT_ANSWERS, ...(draft.answers || {}) })
        setFlags(draft.flags || {})
        setRoundIndex(draft.roundIndex || 0)
        setPictureData(draft.pictureData || null)
      }
    } catch {}
  }, [])

  // Persist config & draft
  useEffect(() => {
    try { localStorage.setItem('bestie_config', JSON.stringify({ weights, proxyFraction })) } catch {}
  }, [weights, proxyFraction])

  useEffect(() => {
    try {
      localStorage.setItem('bestie_quiz_draft', JSON.stringify({ candidateName, answers, flags, roundIndex, pictureData, ts: Date.now() }))
    } catch {}
  }, [candidateName, answers, flags, roundIndex, pictureData])

  // Load saved scoreboard on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bestie_saved')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setSaved(arr)
      }
    } catch {}
  }, [])

  // Persist saved scoreboard whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('bestie_saved', JSON.stringify(saved))
    } catch {}
  }, [saved])

  const ev = useMemo(() => evidenceBreakdown(answers, weights, proxyFraction), [answers, weights, proxyFraction])

  // Dynamic normalization: denominator reflects direct + proxy contributions
  const score = useMemo(() => {
    let num = 0
    let denom = 0
    for (const [k, w] of Object.entries(weights)) {
      const hasDirect = answers[k] != null
      const contrib = hasDirect ? 1 : proxyFraction
      const value = hasDirect ? answers[k] : proxyForField(k, answers)
      num += (value || 0) * w * contrib
      denom += 5 * w * contrib
    }
    if (denom === 0) return 0
    const normalized = Math.round((num / denom) * 100)
    return Math.min(100, Math.max(0, normalized))
  }, [answers, weights, proxyFraction])

  const dealbreakerCount = useMemo(() => Object.values(flags).filter(Boolean).length, [flags])
  const tier = tierFromScore(score, ev)
  const archetypes = useMemo(() => topArchetypesFromAnswers(answers), [answers])
  const primary = archetypes[0]
  const secondary = archetypes[1]

  const roundQuestions = QUESTIONS.filter((q) => q.round === ROUNDS[roundIndex])

  const handleSet = (id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))

  const onPickFile = (e) => {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    const r = new FileReader()
    r.onload = (ev2) => setPictureData(String(ev2.target?.result || ''))
    r.readAsDataURL(f)
    // allow re-selecting the same file later
    e.target.value = ''
  }
  const resetQuiz = () => {
    setAnswers({ ...DEFAULT_ANSWERS })
    setFlags({})
    setRoundIndex(0)
    setCandidateName('')
  }

  const saveCandidate = async () => {
    const name = candidateName.trim() || `Player ${saved.length + 1}`

    const payload = {
      name,
      archetype_primary: primary?.name,
      archetype_secondary: secondary?.name,
      score,
      evidence_direct: ev.direct,
      evidence_proxy: ev.proxy,
      flags_count: dealbreakerCount,
      red_flags: Object.entries(flags).filter(([, v]) => v).map(([k]) => k),
      snapshot: { ...answers },
      signals: Object.fromEntries(Object.entries(answers).filter(([k]) => k.startsWith('sig_'))),
      picture: pictureData,
    }

    setIsSaving(true); setSaveMsg('')
    try {
      if (typeof onSave === 'function') {
        await onSave(payload)
      } else if (typeof window !== 'undefined' && typeof window.__bestie_onSave === 'function') {
        await window.__bestie_onSave(payload)
      } else if (typeof fetch === 'function') {
        const res = await fetch('/api/friends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        })
        if (res.status === 401) {
          // Public play + gated save: redirect to login and come back
          const returnTo = '/friend-quiz'
          const loginUrl = `/login?returnTo=${encodeURIComponent(returnTo)}`
          setSaveMsg('Please log in to save.')
          window.location.assign(loginUrl)
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      setSaveMsg('Saved to friends ✓')
      if (tier.name === 'Bestie Material' && dealbreakerCount < 2) {
          confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 } })
          confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0 } })
          confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 } })
        }
    } catch (err) {
      console.error('BestieVibes: save failed', err)
      setSaveMsg('Saved locally (API error)')
    } finally {
      setIsSaving(false)
    }

    const entry = {
      id: Date.now(),
      name,
      score,
      tier: tier.name,
      emoji: tier.emoji,
      arch: primary?.name,
      archEmoji: primary?.emoji,
      flags: dealbreakerCount,
      snapshot: { ...answers },
      evidence: ev,
    }
    setSaved((prev) => [entry, ...prev].slice(0, 8))
    resetQuiz()
    setTimeout(() => setSaveMsg(''), 2000)
  }

  const nextRound = () => setRoundIndex((i) => Math.min(i + 1, ROUNDS.length - 1))
  const prevRound = () => setRoundIndex((i) => Math.max(i - 1, 0))

  const suggestion = useMemo(() => {
    const templates = [
      'Coffee walk + meme swap this week? Tue 6p or Sat 11a ☕🚶',
      'Try a new thing together: bouldering/paint night/arcade? 🎨🧗 Sun 3p?',
      'Low-key hang & debrief life? Thu 7p tea or Sun 10a park bench 🫖🌳',
      'Volunteering shift + tacos after? Sat 12p 🌮💪',
    ]
    return templates[Math.floor(Math.random() * templates.length)]
  }, [score, primary?.name])

  const tests = useMemo(() => nextTests(answers, weights), [answers, weights])

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-violet-50 to-white text-[#455a7c] p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Friendship Fit Quiz <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full border border-slate-300 text-xs font-semibold">KAI</span></h1>
            <p className="text-[#455a7c] mt-1">Take this quiz for each current or potential friend to see who to prioritize. Share results, next moves, challenges, and invites with KAI to plan next steps.</p>
            <ul className="text-[#455a7c] mt-1 list-disc list-inside space-y-1 text-sm">
              <li>To save the results, you will be asked to sign in if you are not already signed in.</li>
              <li>All friendship types and a scoreboard of the friends assessed are below.</li>
            </ul>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="Potential/Current Friend name"
              className="px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#455a7c]"
            />

            {/* Mobile camera (capture) */}
            <label className="px-3 py-2 rounded-xl border bg-white cursor-pointer hover:bg-[#455a7c]/5 text-sm">
              <input
                ref={camInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onPickFile}
              />
              📷 Camera
            </label>

            {/* File upload */}
            <label className="px-3 py-2 rounded-xl border bg-white cursor-pointer hover:bg-[#455a7c]/5 text-sm">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickFile}
              />
              🖼️ Upload
            </label>
            {pictureData && (
              <div className="flex items-center gap-2">
                <img src={pictureData} alt="preview" className="h-10 w-10 rounded-xl object-cover border" />
                <button
                  onClick={() => setPictureData(null)}
                  className="px-2 py-1 rounded-lg border bg-white hover:bg-[#455a7c]/5 text-xs"
                >Clear</button>
              </div>
            )}

            <button
              onClick={saveCandidate}
              disabled={isSaving}
              className={`px-4 py-2 rounded-2xl text-white font-medium shadow active:translate-y-px ${isSaving ? 'bg-[#455a7c]/40 cursor-not-allowed' : 'bg-[#455a7c] hover:shadow-md'}`}
            >{isSaving ? 'Saving…' : 'Save'}</button>
            <span className="text-xs text-[#455a7c]">{saveMsg}</span>
          </div>
        </header>

        {isAdminMode && (
          <div className="flex items-center justify-end mb-4">
            <button onClick={() => setShowConfig(v => !v)} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-[#455a7c]/5 text-sm">⚙️ Scoring</button>
          </div>
        )}

        {isAdminMode && showConfig && (
          <div className="p-4 rounded-2xl bg-white shadow-sm border mb-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Scoring Controls</h2>
              <button onClick={() => { setWeights({ ...WEIGHTS }); setProxyFraction(DEFAULT_PROXY_FRACTION) }} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-[#455a7c]/5 text-sm">Reset defaults</button>
            </div>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">
              {Object.entries(weights).map(([k,v]) => (
                <label key={k} className="text-sm">
                  <div className="font-medium capitalize">{k}</div>
                  <input type="range" min={0} max={5} step={1} value={v} onChange={(e)=> setWeights(prev => ({ ...prev, [k]: Number(e.target.value) }))} className="w-full" />
                  <div className="text-xs text-slate-600">Weight: {v}</div>
                </label>
              ))}
            </div>
            <div className="mt-3">
              <div className="font-medium text-sm">Proxy fraction</div>
              <input type="range" min={0} max={1} step={0.05} value={proxyFraction} onChange={(e)=> setProxyFraction(Number(e.target.value))} className="w-full" />
              <div className="text-xs text-slate-600">{Math.round(proxyFraction * 100)}% credit when using first‑meet signals as proxies</div>
            </div>
          </div>
        )}

        {/* Scoreboard */}
        <div className="grid md:grid-cols-4 gap-4 mb-6">
          {/* Score card */}
          <div className="p-4 rounded-2xl bg-white shadow-sm border col-span-2 md:col-span-1">
            <div className="text-sm text-[#455a7c]">Friendship Score</div>
            <div className="mt-1 flex items-end gap-3">
              <div className="text-5xl font-extrabold">{dealbreakerCount >= 2 ? '🚫' : score}</div>
              <div className="flex-1">
                <div className="w-full h-3 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full ${dealbreakerCount >= 2 ? 'bg-red-400' : 'bg-[#455a7c]'}`}
                    style={{ width: `${dealbreakerCount >= 2 ? 100 : score}%` }}
                  />
                </div>
                <div className="text-xs text-[#455a7c] mt-1">{dealbreakerCount >= 2 ? '2+ red flags = auto‑pass' : tier.name}</div>
              </div>
            </div>
          </div>

          {/* Evidence card */}
          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <div className="text-sm text-[#455a7c]">Evidence</div>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex items-center justify-between"><span>Direct</span><span className="font-semibold">{Math.round(ev.direct * 100)}%</span></div>
              <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${ev.direct * 100}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2"><span>Proxy</span><span className="font-semibold">{Math.round(ev.proxy * 100)}%</span></div>
              <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-indigo-400" style={{ width: `${ev.proxy * 100}%` }} />
              </div>
            </div>
            <div className="text-xs text-[#455a7c] mt-2">More direct answers = higher confidence and stronger tiers.</div>
          </div>

          {/* Archetype card */}
          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <div className="text-sm text-[#455a7c]">Friend Type</div>
            <div className="mt-1 text-2xl font-bold">{primary?.emoji} {primary?.name}</div>
            <div className="text-sm text-[#455a7c]">{primary?.desc}</div>
            <div className="text-xs text-[#455a7c] mt-2">Secondary: <span className="font-medium">{secondary?.emoji} {secondary?.name}</span></div>
          </div>

          {/* Next move */}
          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <div className="text-sm text-[#455a7c]">Next move</div>
            <div className="mt-1 text-[#455a7c]">{suggestion}</div>
            <div className="text-xs text-[#455a7c] mt-2">Top tests to run:</div>
            <ul className="text-xs text-[#455a7c] list-disc list-inside mt-1 space-y-1">
              {tests.map((t) => (<li key={t.k}><b>{t.k}</b>: {t.tip}</li>))}
            </ul>
          </div>
        </div>

        {/* Dealbreaker Bingo */}
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-rose-700">1.	Red‑Flag Bingo 🚩: select concerns with this person you have</h2>
            <div className="text-sm text-rose-700">{dealbreakerCount} / 2 triggers auto‑pass</div>
          </div>
          <div className="grid sm:grid-cols-5 gap-2 mt-3">
            {DEALBREAKERS.map((d) => (
              <label key={d.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${flags[d.id] ? 'bg-rose-100 border-rose-300' : 'bg-white'} cursor-pointer`}>
                <input
                  type="checkbox"
                  className="accent-rose-500"
                  checked={!!flags[d.id]}
                  onChange={(e) => setFlags((prev) => ({ ...prev, [d.id]: e.target.checked }))}
                />
                <span>{d.emoji} {d.label}</span>
              </label>
            ))}
          </div>
          {dealbreakerCount >= 2 && (
            <div className="mt-3 text-sm text-rose-700">Kind to notice early. Lower investment; keep it casual.</div>
          )}
        </div>

        {/* Round Navigator */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-[#455a7c] font-bold">2. {ROUNDS[roundIndex]} {roundIndex + 1}/{ROUNDS.length}: Answer all of these to assess this person’s friend type and fit for you</div>
          <div className="flex gap-2">
            <button onClick={prevRound} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-[#455a7c]/5 disabled:opacity-50" disabled={roundIndex === 0}>Back</button>
            <button onClick={nextRound} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-[#455a7c]/5 disabled:opacity-50" disabled={roundIndex === ROUNDS.length - 1}>Next</button>
          </div>
        </div>

        {/* Questions */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {roundQuestions.map((q) => (
            <div key={q.id} className="p-4 rounded-2xl bg-white shadow-sm border">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{q.emoji} {q.title}</h3>
                <span className="text-xs text-[#455a7c]">{weights[q.weightKey] ? `×${weights[q.weightKey]}` : (q.id.startsWith('sig_') ? 'signal' : 'archetype')}</span>
              </div>
              <div className="text-sm text-[#455a7c] mt-1">{q.hint}</div>
              <div className="mt-3 flex justify-between text-xs text-[#455a7c]">
                <span>Low</span><span>High</span>
              </div>
              <div className="mt-1 grid grid-cols-6 gap-2">
                {[1,2,3,4,5].map((n) => (
                  <button
                    key={n}
                    onClick={() => handleSet(q.id, n)}
                    className={`h-12 inline-flex items-center justify-center rounded-xl border text-sm font-medium transition ${answers[q.id] === n ? 'bg-[#455a7c] text-white border-[#455a7c]' : 'bg-white hover:bg-[#455a7c]/5'}`}
                  >{n}</button>
                ))}
                <button
                  onClick={() => handleSet(q.id, null)}
                  className={`h-12 inline-flex items-center justify-center rounded-xl border text-sm font-medium transition whitespace-nowrap col-span-6 sm:col-span-3 ${answers[q.id] == null ? 'bg-[#455a7c] text-white border-[#455a7c]' : 'bg-white hover:bg-[#455a7c]/5'}`}
                >🤷 Not sure yet</button>
              </div>
            </div>
          ))}
        </div>

        {/* Tips & micro-challenges */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <h3 className="font-semibold">Micro‑Challenges 🎯</h3>
            <ul className="list-disc list-inside text-[#455a7c] mt-2 space-y-1">
              <li><b>Signal reliability:</b> set a plan in 2 taps; follow up next day with a meme or link.</li>
              <li><b>Safety check:</b> share a medium‑vulnerable story; notice how they handle it.</li>
              <li><b>Overlap test:</b> propose a repeating anchor (Thu walk / Sun coffee).</li>
            </ul>
          </div>
          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <h3 className="font-semibold">Invite Scripts 💬</h3>
            <div className="text-[#455a7c] mt-2 space-y-2">
              <p>• “This week: coffee walk & catch‑up? Tue 6p or Sat 11a ☕🚶”</p>
              <p>• “Paint night / bouldering / arcade run—feel like trying one? 🎨🧗 Sun 3p?”</p>
              <p>• “Thu mini‑tradition: 30‑min walk & life debrief—down?”</p>
            </div>
          </div>
        </div>

        {/* Archetype Library & Deep Dive */}
        <div className="p-4 rounded-2xl bg-white shadow-sm border mb-8">
          <h3 className="font-semibold">Friendship Types — Do you have them all? Which is most important to you?</h3>
          <p className="text-sm text-[#455a7c] mt-2">This main types of friends are: <b>Depth</b> (Confidante, Caregiver), <b>Stability</b> (Anchor), <b>Novelty</b> (Adventurer), <b>Coordination</b> (Communicator, Connector), and <b>Growth</b> (Coach, Collaborator). Most close friends blend 2–3. Use the cards below to spot strengths, watch‑outs, and best micro‑plans.</p>

          <div className="grid md:grid-cols-2 gap-3 mt-4">
            {[
              { key: 'Confidante', emoji: '🫶', title: 'Confidante', strengths: 'Listening, honesty, vulnerability, confidentiality.', plans: ['Tea walks', 'late‑night talks', 'journal/reading circle'], watch: 'Can tilt heavy; avoid turning every hang into therapy.', invest: 'Steady check‑ins, gentle truth‑telling, celebrate their wins too.' },
              { key: 'Anchor', emoji: '🧱', title: 'Anchor', strengths: 'Reliability, routines, punctuality, calm.', plans: ['Weekly run', 'co‑working block', 'errand + lunch'], watch: 'Ruts and sameness; add tiny novelty.', invest: 'Honor time blocks, be on time, set traditions.' },
              { key: 'Adventurer', emoji: '🧗', title: 'Adventurer', strengths: 'Novelty, momentum, courage to try stuff.', plans: ['New restaurant', 'day hike', 'class drop‑in'], watch: 'Over‑scheduling or flaking; add post‑hang debrief.', invest: 'Pre‑book dates, keep a shared “ideas” list.' },
              { key: 'Communicator', emoji: '📣', title: 'Communicator', strengths: 'Smooth plans, conflict repair, vibe calibration.', plans: ['Voice‑note catch‑ups', 'plan‑jam session'], watch: 'Over‑planning; keep space for spontaneity.', invest: 'Share norms (text speed, cancel rules), say thanks for logistics labor.' },
              { key: 'Connector', emoji: '🤝', title: 'Connector', strengths: 'Introductions, group glue, community builder.', plans: ['Bring‑a‑friend brunch', 'board‑game night'], watch: 'Surface‑level time only; protect 1:1s.', invest: 'Co‑host, help with invites, prioritize dedicated time.' },
              { key: 'Coach', emoji: '📈', title: 'Coach', strengths: 'Accountability, feedback, goals, hype.', plans: ['Gym/accountability check‑ins', 'skill swaps'], watch: 'Unsolicited advice; ask consent.', invest: 'Define goals, celebrate wins, rotate whose goals get focus.' },
              { key: 'Collaborator', emoji: '🎨', title: 'Collaborator', strengths: 'Make/learn things together; flow state.', plans: ['Build/record/paint session', 'hack day'], watch: 'Project drift causing friction.', invest: 'Set scope & roles, do small showcases.' },
              { key: 'Caregiver', emoji: '🩹', title: 'Caregiver', strengths: 'Empathy, caretaking, steadying presence.', plans: ['Soup + movie', 'soft errands', 'quiet co‑time'], watch: 'Burnout or unequal caretaking.', invest: 'Reciprocate support, ask what helps, give them light, fun time too.' },
            ].map((c) => (
              <div key={c.key} className="p-3 rounded-xl border bg-white">
                <div className="font-semibold">{c.emoji} {c.title}</div>
                <div className="text-xs text-[#455a7c] mt-1"><b>Strengths:</b> {c.strengths}</div>
                <div className="text-xs text-[#455a7c] mt-1"><b>Best micro‑plans:</b> {c.plans.join(', ')}.</div>
                <div className="text-xs text-[#455a7c] mt-1"><b>Watch‑outs:</b> {c.watch}</div>
                <div className="text-xs text-[#455a7c] mt-1"><b>Invest to thrive:</b> {c.invest}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Saved candidates */}
        <div className="p-4 rounded-2xl bg-white shadow-sm border">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Scoreboard 📊</h3>
            <button onClick={() => setSaved([])} className="text-sm text-[#455a7c] hover:underline">Clear</button>
          </div>
          {saved.length === 0 ? (
            <div className="text-[#455a7c] text-sm mt-2">Save a few players to compare tiers.</div>
          ) : (
            <div className="mt-3 grid gap-2">
              {saved.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-8 rounded ${s.flags >= 2 ? 'bg-rose-400' : 'bg-[#455a7c]'}`} />
                    <div>
                      <div className="font-semibold">{s.emoji} {s.name} — {s.score}</div>
                      <div className="text-xs text-[#455a7c]">{s.tier} • {s.archEmoji} {s.arch} • Direct {Math.round((s.evidence?.direct||0)*100)}% / Proxy {Math.round((s.evidence?.proxy||0)*100)}%</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.flags >= 2 && <span className="text-xs text-rose-600">{s.flags}🚩 auto‑pass</span>}
                    <button
                      onClick={() => setSaved((prev) => prev.filter((x) => x.id !== s.id))}
                      className="px-2 py-1 rounded-lg border bg-white hover:bg-[#455a7c]/5 text-sm"
                    >Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="text-center text-xs text-[#455a7c] mt-6">
          Not a diagnosis—just a vibe compass. Thin-slice wisely: upgrade proxies to direct evidence over 2–3 micro‑hangs. 💜
        </footer>
      </div>
    </div>
  )
}
