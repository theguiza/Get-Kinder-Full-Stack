// Minimal shims so React and friends don’t choke in strict environments
if (typeof window !== "undefined") {
  if (!window.process) window.process = { env: { NODE_ENV: "production" } };
  if (!window.global) window.global = window;
}

import React from "react";
import ReactDOM from "react-dom/client";

// ---- Friend Challenges (new)
import FriendChallenges from "./friendChallenges.jsx";

import BestieVibesQuiz from "./BestieVibesQuiz.jsx";
import { EventsApp } from "./events/App.jsx";

const ROOTS = new WeakMap();

// Reuse a single React root per element so auto-boot and manual calls never double-mount
function getOrCreateRoot(el) {
  if (!el) return null;
  let root = ROOTS.get(el);
  if (!root) {
    root = ReactDOM.createRoot(el);
    ROOTS.set(el, root);
  }
  return root;
}

window.renderBestieVibesQuiz = (selector, props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(<BestieVibesQuiz {...props} />);
};
// ---- Friend Challenges (new)
window.renderFriendChallenges = (selector = "#friend-challenges-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <FriendChallenges {...props} />
    </React.StrictMode>
  );
};

// ---- Onboarding
import OnboardingCards, { getDefaultSteps } from "./components/OnboardingCards.tsx";

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootOnboarding();
  }, { once: true });
} else {
  bootOnboarding();
}

// Optional manual helper to mount anywhere (used by the EJS fallback injector, if present)
window.renderOnboarding = (selector = "#onboarding-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(<OnboardingCards {...props} />);
};

function readPropsFromDom(id = "events-props") {
  const el = document.getElementById(id);
  if (!el) return {};
  try {
    return JSON.parse(el.textContent || "{}");
  } catch {
    return {};
  }
}

window.renderEventsApp = (selector = "#events-root", props) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  const mergedProps = props && typeof props === "object" ? props : readPropsFromDom();
  root.render(
    <React.StrictMode>
      <EventsApp {...mergedProps} />
    </React.StrictMode>
  );
};
