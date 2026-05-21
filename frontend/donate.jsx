import React, { useState } from "react";

const DEFAULT_CHECKOUT_URL = "https://checkout.square.site/merchant/ML7WXHMB2XEJD/checkout/WBQKBZNKKR4Z5GRIZ42LCYFQ";
const DEFAULT_AMOUNTS = [2500, 5000, 10000, 25000];

function formatCurrency(cents = 0) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function formatHours(hours = 0) {
  const rounded = Math.round(Number(hours || 0) * 10) / 10;
  return rounded % 1 === 0 ? String(rounded.toFixed(0)) : String(rounded.toFixed(1));
}

function buildImpactEstimate(amountCents) {
  const credits = Math.floor((Number(amountCents) || 0) / 100);
  return {
    fundingCredits: credits,
    standardHours: credits / 10,
    skilledHours: credits / 15,
    leadershipHours: credits / 30,
  };
}

function StepCard({ number, title, body }) {
  return (
    <div className="donate-step-card">
      <div className="donate-step-number">{number}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export default function DonatePage({
  isAuthenticated = false,
  donorDashboardUrl = "/donor",
  loginUrl = "/login",
  checkoutUrl = DEFAULT_CHECKOUT_URL,
  supportEmail = "kai@getkinder.ai",
} = {}) {
  const [selectedAmount, setSelectedAmount] = useState(DEFAULT_AMOUNTS[1]);
  const estimate = buildImpactEstimate(selectedAmount);

  return (
    <div className="donate-page-shell">
      <section className="donate-hero">
        <div className="donate-hero-copy">
          <div className="donate-eyebrow">Verified community impact</div>
          <h1>
            <span>Fund volunteer work.</span>
            <span>See the impact you make.</span>
            <span>Earn rewards.</span>
          </h1>
          <p className="donate-lead">
            You shouldn&apos;t have to wonder where your money went. We show you proof by tracing your gift to
            verified volunteer action in your community. Real people who showed up for real events. Real impact
            you made possible while you earn rewards along the way.
          </p>

          <div className="donate-amount-panel">
            <div className="donate-panel-label">Suggested gift levels</div>
            <div className="donate-pill-row">
              {DEFAULT_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`donate-pill ${selectedAmount === amount ? "is-active" : ""}`}
                  onClick={() => setSelectedAmount(amount)}
                >
                  {formatCurrency(amount)}
                </button>
              ))}
            </div>
            <p className="donate-panel-note">
              These are impact estimates for planning only. Final payment is completed inside Square and can be adjusted there.
            </p>
            <div className="donate-impact-band">
              <div>
                <span className="donate-impact-value">{estimate.fundingCredits}</span>
                <span className="donate-impact-label">funding IC minted</span>
              </div>
              <div>
                <span className="donate-impact-value">{formatHours(estimate.standardHours)}</span>
                <span className="donate-impact-label">hrs at standard rate</span>
              </div>
              <div>
                <span className="donate-impact-value">{formatHours(estimate.skilledHours)}</span>
                <span className="donate-impact-label">hrs at skilled rate</span>
              </div>
              <div>
                <span className="donate-impact-value">{formatHours(estimate.leadershipHours)}</span>
                <span className="donate-impact-label">hrs at leadership rate</span>
              </div>
            </div>
            <div className="donate-cta-row">
              <a className="donate-btn donate-btn-primary" href={checkoutUrl} target="_blank" rel="noopener noreferrer">
                Open Square Checkout
              </a>
              <a className="donate-btn donate-btn-secondary" href="/events">
                Browse Opportunities
              </a>
            </div>
          </div>
        </div>

        <aside className="donate-status-rail">
          <div className="donate-rail-card">
            <div className="donate-panel-label">What happens after checkout</div>
            <StepCard
              number="01"
              title="Checkout completes in Square"
              body="The payment is processed externally through Square's hosted checkout."
            />
            <StepCard
              number="02"
              title="Donation enters review"
              body={`Kinder sends a donation review notification to ${supportEmail} so the funding can be allocated intentionally.`}
            />
            <StepCard
              number="03"
              title="Allocation and reporting follow"
              body="Admin can allocate to an org, event, or unrestricted pool. Later reporting ties funded impact back to that donation."
            />
          </div>
        </aside>
      </section>

      <section className="donate-account-grid">
        <div className="donate-card donate-card-warm">
          <div className="donate-panel-label">Tracking and claim flow</div>
          <h2>{isAuthenticated ? "Already signed in?" : "Want donation tracking?"}</h2>
          <p>
            {isAuthenticated
              ? "Use your Donor Dashboard to review receipts and claim a donation if it does not show automatically after checkout."
              : "Guest donations can still be matched later, but logging in gives you access to the Donor Dashboard and the claim flow."}
          </p>
          <div className="donate-inline-actions">
            {isAuthenticated ? (
              <a className="donate-btn donate-btn-ink" href={donorDashboardUrl}>
                Open Donor Dashboard
              </a>
            ) : (
              <a className="donate-btn donate-btn-ink" href={loginUrl}>
                Log In To Track Donations
              </a>
            )}
            <a className="donate-link" href="/events">
              Browse volunteer opportunities
            </a>
          </div>
        </div>

        <div className="donate-card">
          <div className="donate-panel-label">Current product reality</div>
          <ul className="donate-list">
            <li>Donations are reviewed before allocation.</li>
            <li>Unrestricted donations do not automatically subsidize every event.</li>
            <li>Manual attribution still matters while the donor flow is being upgraded.</li>
            <li>The old payment-ID paste flow has been removed from this page.</li>
          </ul>
        </div>
      </section>

      <style>{`
        .donate-page-shell {
          --donate-coral: #ff5656;
          --donate-ink: #33425f;
          --donate-cream: #fff8ef;
          --donate-sand: #f2e7d9;
          --donate-mint: #eff8f1;
          max-width: 1180px;
          margin: 0 auto;
          padding: 28px 16px 56px;
          color: #25324a;
        }
        .donate-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.95fr);
          gap: 22px;
          align-items: start;
        }
        .donate-hero-copy,
        .donate-rail-card,
        .donate-card {
          border: 1px solid rgba(69, 90, 124, 0.12);
          border-radius: 24px;
          background: #fff;
          box-shadow: 0 18px 40px rgba(34, 50, 74, 0.08);
        }
        .donate-hero-copy {
          padding: 28px;
          background:
            radial-gradient(circle at top right, rgba(255, 86, 86, 0.14), transparent 32%),
            linear-gradient(180deg, #fffaf4 0%, #ffffff 52%);
        }
        .donate-status-rail {
          position: sticky;
          top: 108px;
        }
        .donate-rail-card {
          padding: 22px;
          background:
            linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
        }
        .donate-eyebrow,
        .donate-panel-label {
          font-size: 0.74rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #7b879b;
        }
        .donate-hero h1 {
          margin: 10px 0 12px;
          font-size: clamp(2rem, 3.5vw, 3.5rem);
          line-height: 0.95;
          color: var(--donate-ink);
        }
        .donate-hero h1 span {
          display: block;
          white-space: nowrap;
        }
        .donate-lead {
          max-width: 58ch;
          margin: 0 0 22px;
          font-size: 1.02rem;
          line-height: 1.65;
          color: #50607d;
        }
        .donate-amount-panel {
          border: 1px solid rgba(69, 90, 124, 0.1);
          border-radius: 20px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.8);
        }
        .donate-pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin: 10px 0 10px;
        }
        .donate-pill {
          border: 1px solid #cfd8e6;
          background: #fff;
          color: #25324a;
          border-radius: 999px;
          padding: 10px 16px;
          font-weight: 800;
          cursor: pointer;
          transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
        }
        .donate-pill:hover {
          transform: translateY(-1px);
          border-color: #9aa8bf;
        }
        .donate-pill.is-active {
          border-color: var(--donate-coral);
          background: var(--donate-coral);
          color: #fff;
        }
        .donate-panel-note {
          margin: 0 0 16px;
          font-size: 0.9rem;
          color: #6f7c93;
        }
        .donate-impact-band {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 18px;
        }
        .donate-impact-band > div {
          border-radius: 16px;
          padding: 14px;
          background: var(--donate-cream);
          border: 1px solid var(--donate-sand);
        }
        .donate-impact-value {
          display: block;
          font-size: 1.45rem;
          font-weight: 800;
          color: var(--donate-ink);
        }
        .donate-impact-label {
          display: block;
          margin-top: 2px;
          font-size: 0.8rem;
          color: #6f7c93;
        }
        .donate-cta-row,
        .donate-inline-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }
        .donate-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 48px;
          padding: 0 18px;
          border-radius: 14px;
          font-weight: 800;
          text-decoration: none;
          transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
        }
        .donate-btn:hover {
          transform: translateY(-1px);
        }
        .donate-btn-primary {
          background: var(--donate-coral);
          color: #fff;
        }
        .donate-btn-secondary {
          background: #edf1f8;
          color: var(--donate-ink);
        }
        .donate-btn-ink {
          background: var(--donate-ink);
          color: #fff;
        }
        .donate-link {
          color: var(--donate-ink);
          font-weight: 700;
          text-decoration: underline;
          text-underline-offset: 0.18em;
        }
        .donate-step-card + .donate-step-card {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #edf1f7;
        }
        .donate-step-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: #fff2f2;
          color: var(--donate-coral);
          font-weight: 800;
          letter-spacing: 0.06em;
          margin-bottom: 10px;
        }
        .donate-step-card h3 {
          margin: 0 0 6px;
          font-size: 1rem;
          color: var(--donate-ink);
        }
        .donate-step-card p {
          margin: 0;
          color: #5f6f89;
          line-height: 1.55;
          font-size: 0.94rem;
        }
        .donate-account-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          margin-top: 18px;
        }
        .donate-card {
          padding: 22px;
        }
        .donate-card h2 {
          margin: 8px 0 10px;
          font-size: 1.45rem;
          color: var(--donate-ink);
        }
        .donate-card p {
          margin: 0 0 16px;
          color: #5f6f89;
          line-height: 1.6;
        }
        .donate-card-warm {
          background: linear-gradient(180deg, #fff9f0 0%, #ffffff 100%);
        }
        .donate-list {
          margin: 8px 0 0;
          padding-left: 18px;
          color: #4f5f7d;
          line-height: 1.75;
        }
        @media (max-width: 991px) {
          .donate-hero,
          .donate-account-grid,
          .donate-impact-band {
            grid-template-columns: 1fr;
          }
          .donate-status-rail {
            position: static;
          }
        }
      `}</style>
    </div>
  );
}
