import React, { useRef, useState } from "react";
import FriendCheckQuiz from "./FriendCheckQuiz.jsx";
import MyFriendshipEnergyQuiz from "./MyFriendshipEnergyQuiz.jsx";

function TabButton({ active, label, sublabel, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center text-center gap-1 px-4 py-3 rounded-2xl border transition ${
        active
          ? "border-[#ff5656] bg-[#ff5656]/10 text-[#455a7c] shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 text-[#455a7c]"
      }`}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs text-slate-600">{sublabel}</span>
    </button>
  );
}

export default function FriendQuizzesPage({ userId }) {
  const [activeTab, setActiveTab] = useState("friend-check");
  const [friendCheckResult, setFriendCheckResult] = useState(null);
  const [energyResult, setEnergyResult] = useState(null);
  const isFriendCheck = activeTab === "friend-check";
  const sidebarRef = useRef(null);

  const scrollToSidebar = () => {
    if (sidebarRef.current) {
      sidebarRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-[#455a7c]">
      <div className="max-w-5xl mx-auto px-4 py-10 md:py-14 space-y-10">
        <header className="text-center space-y-4">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff5656]/10 text-[#ff5656] text-xs font-semibold">
            New · Friend Quizzes
          </span>
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              Upgrade Your Friend Circle
            </h1>
          </div>
          <p className="max-w-3xl mx-auto text-slate-600 text-sm md:text-base">
            Take 2 minutes to complete a Friend Check quiz on a friend and find out what type of friend they are and KAI will create a Friend Arc - small simple actions you can take to connect with that person more!
            <br />
            or
            <br />
            Complete a My Friendship Energy quiz to discover your friendship superpowers and learn how you can be a better friend.
          </p>
        </header>

        <div className="flex justify-center">
          <div className="inline-flex gap-3 bg-white border border-slate-200 rounded-2xl p-2 shadow-sm">
            <TabButton
              active={isFriendCheck}
              label="Friend Check"
              sublabel="One friend at a time"
              onClick={() => setActiveTab("friend-check")}
            />
            <TabButton
              active={!isFriendCheck}
              label="My Friendship Energy"
              sublabel="How you show up"
              onClick={() => setActiveTab("my-friendship-energy")}
            />
          </div>
        </div>

        <div className="grid gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="space-y-4">
            {isFriendCheck ? (
              <>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold">Friend Check</h2>
                  <p className="text-slate-600 text-sm md:text-base">
                    Pick one person, answer a few questions about how things
                    have actually been lately, and KAI will tell you what level
                    that friendship’s at + tiny, non-cringe next moves.
                  </p>
                </div>
                <FriendCheckQuiz
                  userId={userId}
                  onScore={(res) => setFriendCheckResult(res)}
                  onAfterResult={scrollToSidebar}
                />
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold">My Friendship Energy</h2>
                  <p className="text-slate-600 text-sm md:text-base">
                    Answer about how you show up as a friend, and KAI will map
                    your superpowers, growth edges, and a couple of tiny quests
                    to help you get more Close / Best Friends.
                  </p>
                </div>
                <MyFriendshipEnergyQuiz
                  userId={userId}
                  onScore={(res) => setEnergyResult(res)}
                  onAfterResult={scrollToSidebar}
                />
              </>
            )}
          </section>

          <aside
            className="lg:sticky lg:top-24"
            ref={sidebarRef}
            style={{ scrollMarginTop: "140px" }}
          >
            <div className="rounded-3xl bg-[#ff5656] text-white p-6 space-y-4 shadow-xl">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/80">
                  What you’ll get
                </p>
                <h3 className="text-xl font-bold mt-1">
                  {isFriendCheck ? "Friend Check" : "My Friendship Energy"}
                </h3>
              </div>
              {isFriendCheck && friendCheckResult ? (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
                    Level: {friendCheckResult.levelLabel}
                  </div>
                  <p className="text-sm text-slate-200">
                    {friendCheckResult.levelCode === "best_friend" &&
                      "This is Best Friend territory. Keep nurturing it and protect your time together."}
                    {friendCheckResult.levelCode === "close_friend" &&
                      "Close Friend vibes. Add a repeat ritual and a shared plan on the calendar."}
                    {friendCheckResult.levelCode === "friend" &&
                      "Solid Friend zone. A couple of intentional hangs could deepen this toward Close Friend."}
                    {friendCheckResult.levelCode === "casual_friend" &&
                      "Casual Friend. Light touches plus one meaningful hang can move this up."}
                    {friendCheckResult.levelCode === "acquaintance" &&
                      "Feels like an acquaintance right now. Start with small, low-pressure overlap."}
                  </p>
                  {friendCheckResult.topTypes?.length ? (
                    <div className="text-sm text-slate-200">
                      They feel like{" "}
                      {friendCheckResult.topTypes
                        .map((t) => t.label)
                        .join(" + ")}
                      .
                    </div>
                  ) : null}
                  {friendCheckResult.unsafeToDeepen && (
                    <div className="rounded-xl bg-rose-500/15 border border-rose-300/40 p-3 text-sm text-rose-100">
                      Heads up: multiple red flags—pace yourself or set firmer boundaries.
                    </div>
                  )}
                </div>
              ) : isFriendCheck ? (
                <ul className="space-y-2 text-sm leading-relaxed">
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>A Friend Level: Acquaintance → Best Friend</span>
                  </li>
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>
                      A read on what they’re great at (Vault Friend,
                      Adventurer, etc.)
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>2–3 tiny experiments to try with that one friend</span>
                  </li>
                </ul>
              ) : energyResult ? (
                <div className="space-y-3">
                  {energyResult.archetypes?.main?.length ? (
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
                      You’re {energyResult.archetypes.main.map((m) => m.label).join(" + ")}
                    </div>
                  ) : null}
                  <div className="text-sm text-slate-200 space-y-1">
                    {energyResult.strengths?.length ? (
                      <div>
                        Strengths: {energyResult.strengths.join(", ").replaceAll("_", " ")}
                      </div>
                    ) : null}
                    {energyResult.growthEdges?.length ? (
                      <div>
                        Growth edges: {energyResult.growthEdges.join(", ").replaceAll("_", " ")}
                      </div>
                    ) : null}
                  </div>
                  {energyResult.stuckTransitions?.length ? (
                    <div className="text-sm text-slate-200">
                      Stuck transitions: {energyResult.stuckTransitions.join(", ").replaceAll("_", " ")}
                    </div>
                  ) : null}
                  {energyResult.growthEdges?.includes("initiation") && (
                    <div className="rounded-xl bg-amber-500/15 border border-amber-300/40 p-3 text-sm text-amber-50">
                      Quest: One-a-day ping — message one person daily with a specific invite or check-in.
                    </div>
                  )}
                  {energyResult.growthEdges?.includes("vulnerability") && (
                    <div className="rounded-xl bg-amber-500/15 border border-amber-300/40 p-3 text-sm text-amber-50">
                      Quest: Fact → feeling swap — add “how I feel about it” to one update this week.
                    </div>
                  )}
                </div>
              ) : (
                <ul className="space-y-2 text-sm leading-relaxed">
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>
                      Your main friendship energies (Vault Friend, Group Chat Mod, etc.)
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>Which skills might be blocking Close / Best Friend levels</span>
                  </li>
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>Tiny quests to train those exact muscles</span>
                  </li>
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
