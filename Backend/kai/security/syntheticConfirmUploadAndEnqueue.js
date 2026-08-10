import { withTransaction } from "../db/kaiDb.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { confirmUpload as canonicalConfirmUpload } from "../services/kaiIntakeService.js";
import {
  IN_MEMORY_UPLOAD_LIFECYCLE_TRANSACTION_PARTICIPANT,
} from "../upload/inMemoryUploadLifecycleRepository.js";
import {
  SYNTHETIC_SECURITY_ASSESSMENT_ENQUEUE_TRANSACTION_PARTICIPANT,
} from "./syntheticSecurityAssessmentEnqueue.js";

class SyntheticEnqueueRollback extends Error {
  constructor(result) {
    super("synthetic security-assessment enqueue failed");
    this.name = "SyntheticEnqueueRollback";
    this.result = result;
  }
}

function requireTransactionParticipant(target, symbol, name) {
  const participant = target?.[symbol];
  if (!participant || typeof participant.createTransactionParticipant !== "function") {
    throw new TypeError(`${name} must expose the synthetic transaction participant.`);
  }
  return participant;
}

function createSyntheticTransactionProvider({
  uploadLifecycleRepository,
  securityAssessmentEnqueue,
  transactionEvents = null,
}) {
  const lifecycleParticipant = requireTransactionParticipant(
    uploadLifecycleRepository,
    IN_MEMORY_UPLOAD_LIFECYCLE_TRANSACTION_PARTICIPANT,
    "uploadLifecycleRepository",
  );
  const enqueueParticipant = requireTransactionParticipant(
    securityAssessmentEnqueue,
    SYNTHETIC_SECURITY_ASSESSMENT_ENQUEUE_TRANSACTION_PARTICIPANT,
    "securityAssessmentEnqueue",
  );

  return Object.freeze({
    async connect() {
      const context = {
        uploadLifecycleRepository: null,
        securityAssessmentEnqueue: null,
        _participants: null,
        async query(command) {
          if (command === "BEGIN") {
            transactionEvents?.push?.("BEGIN");
            const lifecycleTransaction = lifecycleParticipant.createTransactionParticipant();
            const enqueueTransaction = enqueueParticipant.createTransactionParticipant();
            context._participants = [lifecycleTransaction, enqueueTransaction];
            context.uploadLifecycleRepository = lifecycleTransaction.repository;
            context.securityAssessmentEnqueue = enqueueTransaction.capability;
            return { rows: [] };
          }
          if (command === "COMMIT") {
            const [lifecycleTransaction, enqueueTransaction] = context._participants || [];
            const lifecyclePublication = lifecycleTransaction.prepareCommit();
            const enqueuePublication = enqueueTransaction.prepareCommit();
            lifecyclePublication.target.state = lifecyclePublication.preparedState;
            enqueuePublication.target.state = enqueuePublication.preparedState;
            transactionEvents?.push?.("COMMIT");
            return { rows: [] };
          }
          if (command === "ROLLBACK") {
            transactionEvents?.push?.("ROLLBACK");
            return { rows: [] };
          }
          throw new Error("unsupported synthetic transaction command");
        },
        release() {},
      };
      return context;
    },
  });
}

function safeConfirmedFacts(result, confirmedTransition, metadata) {
  const data = result?.data;
  if (!data || !confirmedTransition || !metadata) return null;
  return {
    organizationId: data.organization_id,
    intakeFileId: data.intake_file_id,
    objectVersionId: confirmedTransition.objectVersionId,
    verifiedChecksum: confirmedTransition.verifiedChecksum,
    verifiedSizeBytes: confirmedTransition.verifiedSizeBytes,
    declaredMime: metadata.mime_type,
    extension: metadata.file_extension,
  };
}

export function createSyntheticConfirmUploadAndEnqueue({
  uploadLifecycleRepository,
  securityAssessmentEnqueue,
  confirmUpload = canonicalConfirmUpload,
  runInTransaction = null,
  transactionEvents = null,
} = {}) {
  if (!uploadLifecycleRepository || !securityAssessmentEnqueue) {
    throw new TypeError("Synthetic confirmation composition requires lifecycle and enqueue participants.");
  }

  const syntheticProvider = createSyntheticTransactionProvider({
    uploadLifecycleRepository,
    securityAssessmentEnqueue,
    transactionEvents,
  });
  const executeTransaction = runInTransaction
    || ((callback) => withTransaction(callback, syntheticProvider));

  return Object.freeze({
    async confirmUpload(input = {}, dependencies = {}) {
      let capturedMetadata = null;
      let confirmedTransition = null;
      const readFile = dependencies.getIntakeFileMetadata;

      try {
        return await executeTransaction(async (transactionContext) => {
          const transactionLifecycleRepository = transactionContext.uploadLifecycleRepository;
          const transactionEnqueue = transactionContext.securityAssessmentEnqueue;
          if (!transactionLifecycleRepository || !transactionEnqueue) {
            throw new SyntheticEnqueueRollback(buildKaiError("system_error"));
          }

          const confirmResult = await confirmUpload(input, {
            ...dependencies,
            uploadLifecycleRepository: {
              getUploadLifecycle(nextInput) {
                return transactionLifecycleRepository.getUploadLifecycle(nextInput);
              },
              transitionUploadLifecycle(nextInput) {
                const result = transactionLifecycleRepository.transitionUploadLifecycle(nextInput);
                if (nextInput?.newUploadState === "confirmed" && result?.ok === true) {
                  confirmedTransition = {
                    objectVersionId: nextInput.objectVersionId,
                    verifiedChecksum: nextInput.verifiedChecksum,
                    verifiedSizeBytes: nextInput.verifiedSizeBytes,
                  };
                }
                return result;
              },
            },
            async getIntakeFileMetadata(organizationId, intakeFileId) {
              if (typeof readFile !== "function") return null;
              const row = await readFile(organizationId, intakeFileId);
              capturedMetadata = row;
              return row;
            },
          });

          if (confirmResult?.ok !== true) return confirmResult;

          const facts = safeConfirmedFacts(confirmResult, confirmedTransition, capturedMetadata);
          if (!facts) {
            throw new SyntheticEnqueueRollback(buildKaiError("conflict_current_state_changed"));
          }

          const enqueueResult = transactionEnqueue.enqueueSecurityAssessment(facts);
          if (enqueueResult?.ok !== true) {
            throw new SyntheticEnqueueRollback(enqueueResult || buildKaiError("system_error"));
          }

          return confirmResult;
        });
      } catch (error) {
        if (error instanceof SyntheticEnqueueRollback) return error.result;
        return buildKaiError("system_error");
      }
    },
  });
}

export const __testables = Object.freeze({
  createSyntheticTransactionProvider,
  safeConfirmedFacts,
});
