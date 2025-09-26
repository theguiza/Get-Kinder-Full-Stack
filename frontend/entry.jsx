// Minimal shims so React and friends don’t choke in strict environments
if (typeof window !== 'undefined') {
  if (!window.process) {
    window.process = { env: { NODE_ENV: 'production' } };
  }
  if (!window.global) {
    window.global = window;
  }
}

import ReactDOM from "react-dom/client";
import BestieVibesQuiz from "./BestieVibesQuiz.jsx";

window.renderBestieVibesQuiz = (selector, props = {}) => {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  const root = ReactDOM.createRoot(el);
  root.render(<BestieVibesQuiz {...props} />);
};

