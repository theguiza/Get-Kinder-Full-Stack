import React from "react";

export function Drawer({ open, onClose, children }) {
  return (
    <>
      {open && <div className="events-drawer-backdrop" onClick={onClose} />}
      <aside className={`events-drawer${open ? " open" : ""}`} aria-hidden={!open}>
        {children}
      </aside>
      <style>{`
        .events-drawer {
          position: fixed;
          top: 0;
          right: -480px;
          width: 480px;
          max-width: 100%;
          height: 100vh;
          background: #ffffff;
          box-shadow: -2px 0 24px rgba(0, 0, 0, 0.12);
          transition: right 0.25s ease;
          z-index: 1040;
          padding: 24px;
          overflow-y: auto;
        }
        .events-drawer.open {
          right: 0;
        }
        .events-drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.25);
          z-index: 1030;
        }
      `}</style>
    </>
  );
}
