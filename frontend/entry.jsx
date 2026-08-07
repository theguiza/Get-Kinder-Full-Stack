// Minimal shims so React and friends don’t choke in strict environments
if (typeof window !== "undefined") {
  if (!window.process) window.process = { env: { NODE_ENV: "production" } };
  if (!window.global) window.global = window;
}

import React from "react";
import ReactDOM from "react-dom/client";

import FundKaiThermometer from "./fundKaiThermometer.jsx";
import { EventsApp } from "./events/App.jsx";
import KinderCrewCarousel from "./kinderCrewCarousel.jsx";
import WeeksPlan from "./weeksPlan.jsx";
import DonorDashboard from "./donorDashboard.jsx";
import DonatePage from "./donate.jsx";
import AdminDashboard from "./adminDashboard.jsx";
import KaiReviewCockpit from "./kaiReviewCockpit.jsx";
import GkExportReviewDetail from "./gkExportReviewDetail.jsx";
import { renderOrgPortal, renderKpiStrip } from "./orgPortal.jsx";
import { renderOrgWorkspace } from "./orgWorkspace.jsx";

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

function renderIntoRoot(el, node, { hydrate = false } = {}) {
  if (!el) return null;
  let root = ROOTS.get(el);
  if (!root) {
    if (hydrate) {
      root = ReactDOM.hydrateRoot(el, node);
      ROOTS.set(el, root);
      return root;
    }
    root = ReactDOM.createRoot(el);
    ROOTS.set(el, root);
  }
  root.render(node);
  return root;
}

// ---- Kinder Crew Carousel
window.renderKinderCrewCarousel = (selector = "#kinder-crew-carousel-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <KinderCrewCarousel {...props} />
    </React.StrictMode>
  );
};

// ---- Weeks Plan
window.renderWeeksPlan = (selector = "#weeks-plan-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <WeeksPlan {...props} />
    </React.StrictMode>
  );
};

window.renderDonorDashboard = (selector = "#donor-dashboard-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <DonorDashboard {...props} />
    </React.StrictMode>
  );
};

window.renderDonatePage = (selector = "#donate-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <DonatePage {...props} />
    </React.StrictMode>
  );
};

window.renderFundKaiThermometer = (selector = "#fund-kai-thermometer-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <FundKaiThermometer {...props} />
    </React.StrictMode>
  );
};

window.renderAdmin = (selector = "#admin-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <AdminDashboard {...props} />
    </React.StrictMode>
  );
};

// KAI P1-09 internal review cockpit. Internal/GK-only: the component itself renders
// nothing unless the KAI_SPRINT2_ENABLED-gated internal API answers its status
// probe, so this entry point exposes no client-facing surface.
window.renderKaiReviewCockpit = (selector = "#kai-review-cockpit-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <KaiReviewCockpit {...props} />
    </React.StrictMode>
  );
};

// KAI P3-08 read-only GK export-review detail page. Internal/GK-only, read-only:
// it issues a single GET against the accepted P3-07 packet route and holds no
// mutation control of any kind.
window.renderGkExportReviewDetail = (selector = "#gk-export-review-detail-root", props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!el) return;
  const root = getOrCreateRoot(el);
  root.render(
    <React.StrictMode>
      <GkExportReviewDetail {...props} />
    </React.StrictMode>
  );
};

window.renderOrgPortal = renderOrgPortal;
window.renderKpiStrip = renderKpiStrip;
window.renderOrgWorkspace = renderOrgWorkspace;

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
  const mergedProps = props && typeof props === "object" ? props : readPropsFromDom();
  const node = (
    <React.StrictMode>
      <EventsApp {...mergedProps} />
    </React.StrictMode>
  );
  const shouldHydrate = Boolean(
    el.firstElementChild && el.firstElementChild.classList.contains("events-ssr-shell")
  );
  renderIntoRoot(el, node, { hydrate: shouldHydrate });
};
