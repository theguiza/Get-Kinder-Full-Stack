// Minimal shims so React and friends don’t choke in strict environments
if (typeof window !== 'undefined') {
  if (!window.process) window.process = { env: { NODE_ENV: 'production' } };
  if (!window.global) window.global = window;
}

import ReactDOM from "react-dom/client";

// ---- Friend Challenges (new)
import FriendChallenges from "./friendChallenges.jsx";

import BestieVibesQuiz from "./BestieVibesQuiz.jsx";
window.renderBestieVibesQuiz = (selector, props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = ReactDOM.createRoot(el);
  root.render(<BestieVibesQuiz {...props} />);
};
// ---- Friend Challenges (new)
window.renderFriendChallenges = (selector = "#friend-challenges-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(<FriendChallenges {...props} />);
};

// ---- Onboarding
import OnboardingCards, { getDefaultSteps } from "./components/OnboardingCards.tsx";

// Reuse a single React root per element so auto-boot and manual calls never double-mount
function getOrCreateRoot(el) {
  if (!el) return null;
  if (!el.__reactRoot) {
    el.__reactRoot = ReactDOM.createRoot(el);
  }
  return el.__reactRoot;
}

// Auto-boot if the page includes <div id="onboarding-root"></div>
function bootOnboarding() {
  const el = document.getElementById("onboarding-root");
  if (!el) return;

  const steps = getDefaultSteps(); // or load your own steps
  const root = getOrCreateRoot(el);
  root.render(
    <OnboardingCards
      steps={steps}
      brand={{ productName: "Get Kinder AI", logoUrl: "/images/logo.png"}} 
      // onComplete not required; component POSTs /api/onboarding/complete internally
    />
  );
}
function bootFriendChallenges() {
  const el = document.getElementById("friend-challenges-root");
  if (!el) return;

  // Optional: allow server to pass initial props via a global
  const props = (window && window.__friendChallengesProps) || {};
  const root = getOrCreateRoot(el);
  root.render(<FriendChallenges {...props} />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootOnboarding();
    bootFriendChallenges();
  }, { once: true });
} else {
  bootOnboarding();
  bootFriendChallenges();
}

// Optional manual helper to mount anywhere (used by the EJS fallback injector, if present)
window.renderOnboarding = (selector = "#onboarding-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(<OnboardingCards {...props} />);
};
