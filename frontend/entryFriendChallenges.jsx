// frontend/entryFriendChallenges.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import FriendChallenges from "./friendChallenges"; 

// Keep one React Root per container (idempotent mounts)
const ROOTS = new WeakMap();

function getEl(selectorOrEl) {
  if (typeof selectorOrEl === "string") {
    const el = document.querySelector(selectorOrEl);
    if (!el) throw new Error("renderFriendChallenges: container not found: " + selectorOrEl);
    return el;
  }
  return selectorOrEl;
}

function renderFriendChallenges(selectorOrEl, props = {}) {
  const el = getEl(selectorOrEl);
  let root = ROOTS.get(el);
  if (!root) {
    root = createRoot(el);
    ROOTS.set(el, root);
  }
  root.render(
    <React.StrictMode>
      <FriendChallenges {...props} />
    </React.StrictMode>
  );
}

function unmountFriendChallenges(selectorOrEl) {
  const el = getEl(selectorOrEl);
  const root = ROOTS.get(el);
  if (root) {
    root.unmount();
    ROOTS.delete(el);
  }
}

// Expose functions globally; DO NOT auto-mount here.
window.renderFriendChallenges = renderFriendChallenges;
window.unmountFriendChallenges = unmountFriendChallenges;
