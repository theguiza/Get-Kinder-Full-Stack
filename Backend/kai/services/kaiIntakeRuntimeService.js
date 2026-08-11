import * as intakeService from "./kaiIntakeService.js";
import { createConfiguredGoogleCloudStorageProvider } from "../config/kaiSprint2GcsConfig.js";
import { createPostgresUploadLifecycleRepository } from "../upload/postgresUploadLifecycleRepository.js";

let runtimeDependencies = null;

export function createKaiIntakeRuntimeDependencies(env = process.env, options = {}) {
  return Object.freeze({
    env,
    gcsProvider: createConfiguredGoogleCloudStorageProvider(env, options),
    uploadLifecycleRepository: createPostgresUploadLifecycleRepository(),
  });
}

function getRuntimeDependencies() {
  runtimeDependencies ||= createKaiIntakeRuntimeDependencies(process.env);
  return runtimeDependencies;
}

function mergeRuntimeDependencies(dependencies = {}) {
  return {
    ...getRuntimeDependencies(),
    ...dependencies,
  };
}

export function resetKaiIntakeRuntimeDependenciesForTest() {
  runtimeDependencies = null;
}

export function setKaiIntakeRuntimeDependenciesForTest(dependencies) {
  runtimeDependencies = dependencies;
  return () => {
    runtimeDependencies = null;
  };
}

export const {
  __testables,
  checkAdminAccess,
  createIntakeBatch,
  getIntakeBatchDetail,
  getIntakeFileDetail,
  listIntakeBatches,
  listIntakeBatchesForOrganization,
  listIntakeFilesForBatch,
  listIntakeFileReviewQueueItems,
  markIntakeFilePolicyBlocked,
  reserveIntakeFileMetadata,
  validateIntakeFileMetadata,
} = intakeService;

export async function uploadReservedIntakeFile(input = {}, dependencies = {}) {
  return intakeService.uploadReservedIntakeFile(input, mergeRuntimeDependencies(dependencies));
}

export async function requestUploadUrl(input = {}, dependencies = {}) {
  return intakeService.requestUploadUrl(input, mergeRuntimeDependencies(dependencies));
}

export async function confirmUpload(input = {}, dependencies = {}) {
  return intakeService.confirmUpload(input, mergeRuntimeDependencies(dependencies));
}
