import React, { useEffect, useState } from "react";

export default function FundKaiThermometer() {
  const [data, setData] = useState({
    combined: 0,
    backers: 0,
    daysRemaining: 0
  });

  useEffect(() => {
    fetch("/api/campaign-totals")
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {});
  }, []);

  const goal = 25000;
  const pct = Math.min(100, Math.round((data.combined / goal) * 100));

  return (
    <div className="fk-thermometer">
      <div className="fk-thermo-bar-wrap">
        <div className="fk-thermo-bar" style={{ width: pct + "%" }} />
      </div>
      <div className="fk-thermo-stats">
        <div className="fk-thermo-stat">
          <span className="fk-thermo-number">${data.combined.toLocaleString()}</span>
          <span className="fk-thermo-label">raised so far</span>
        </div>
        <div className="fk-thermo-stat">
          <span className="fk-thermo-number">{data.backers}</span>
          <span className="fk-thermo-label">backers & donors</span>
        </div>
        <div className="fk-thermo-stat">
          <span className="fk-thermo-number">{data.daysRemaining}</span>
          <span className="fk-thermo-label">days remaining</span>
        </div>
      </div>
    </div>
  );
}
