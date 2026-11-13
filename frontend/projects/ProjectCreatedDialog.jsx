import React, { useEffect, useId, useRef } from "react";

export default function ProjectCreatedDialog({ projectName, returnFocusRef, onDismiss, onAddInformation }) {
  const dialogRef = useRef(null);
  const addInformationRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    addInformationRef.current.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnFocusRef.current?.focus();
    };
  }, [returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className="gk-project-created-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={onDismiss}
      onClose={onDismiss}
    >
      <div className="gk-project-created-dialog-status">Project created</div>
      <h2 id={titleId}>Would you like to add information?</h2>
      <p id={descriptionId}>
        <strong>{projectName}</strong> is ready. Add reports, spreadsheets or other files to start building your impact evidence.
      </p>
      <div className="gk-project-created-dialog-actions">
        <button type="button" onClick={onDismiss}>Not now</button>
        <button ref={addInformationRef} type="button" className="gk-project-created-dialog-primary" onClick={onAddInformation}>
          Yes, add information
        </button>
      </div>
    </dialog>
  );
}
