import { useEffect, useRef, useState } from "react";

import { getJson } from "../impactEvidenceLibraryLogic.js";
import { PIPELINE_REQUEST_STATUS, readClientEvidencePipeline } from "./clientEvidencePipelineLogic.js";

/**
 * The selected project's client-safe evidence pipeline, as an explicit
 * request state (not_started / loading / success_empty / success_with_data /
 * error). The state is keyed to organization + project: a project change
 * discards the previous project's state on the same render, and a response
 * for a superseded key or request is ignored, so it can never repopulate the
 * new project. `refreshToken` re-reads the same project (a tab re-entry or
 * the Refresh button).
 */
export default function useClientEvidencePipeline(organizationId, engagementId, refreshToken = 0) {
  const key = organizationId && engagementId ? `${organizationId}:${engagementId}` : "";
  const [state, setState] = useState({ key: "", status: PIPELINE_REQUEST_STATUS.NOT_STARTED, data: null, error: null });
  const requestSeqRef = useRef(0);

  useEffect(() => {
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    if (!key) {
      setState({ key: "", status: PIPELINE_REQUEST_STATUS.NOT_STARTED, data: null, error: null });
      return undefined;
    }
    setState({ key, status: PIPELINE_REQUEST_STATUS.LOADING, data: null, error: null });
    (async () => {
      const result = await readClientEvidencePipeline(getJson, organizationId, engagementId);
      if (requestSeqRef.current !== requestSeq) return;
      setState({ key, ...result });
    })();
    return () => {
      // Invalidate this request on key change, refresh, or unmount.
      if (requestSeqRef.current === requestSeq) requestSeqRef.current += 1;
    };
  }, [key, organizationId, engagementId, refreshToken]);

  if (!key) return { status: PIPELINE_REQUEST_STATUS.NOT_STARTED, data: null, error: null };
  return state.key === key ? state : { status: PIPELINE_REQUEST_STATUS.LOADING, data: null, error: null };
}
