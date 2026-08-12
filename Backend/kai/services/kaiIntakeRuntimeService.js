import * as intakeService from "./kaiIntakeService.js";
import {
  createConfiguredGoogleCloudStorageParserReaderProvider,
  createConfiguredGoogleCloudStorageProvider,
} from "../config/kaiSprint2GcsConfig.js";
import { createPostgresUploadLifecycleRepository } from "../upload/postgresUploadLifecycleRepository.js";

let runtimeDependencies = null;

export function createKaiIntakeRuntimeDependencies(env = process.env, options = {}) {
  const gcsUploadSignerProvider = createConfiguredGoogleCloudStorageProvider(env, options);
  const gcsParserReaderProvider = createConfiguredGoogleCloudStorageParserReaderProvider(env, options);
  return Object.freeze({
    env,
    gcsProvider: gcsUploadSignerProvider,
    gcsUploadSignerProvider,
    gcsParserReaderProvider,
    uploadLifecycleRepository: createPostgresUploadLifecycleRepository(),
  });
}

function getRuntimeDependencies() {
  runtimeDependencies ||= createKaiIntakeRuntimeDependencies(process.env);
  return runtimeDependencies;
}

function mergeRuntimeDependencies(dependencies = {}, { gcsProviderKey = "gcsProvider" } = {}) {
  const runtime = getRuntimeDependencies();
  const operationGcsProvider =
    dependencies.gcsProvider ||
    dependencies[gcsProviderKey] ||
    runtime[gcsProviderKey] ||
    runtime.gcsProvider;
  return {
    ...runtime,
    ...dependencies,
    gcsProvider: operationGcsProvider,
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
  return intakeService.requestUploadUrl(input, mergeRuntimeDependencies(dependencies, {
    gcsProviderKey: "gcsUploadSignerProvider",
  }));
}

export async function confirmUpload(input = {}, dependencies = {}) {
  return intakeService.confirmUpload(input, mergeRuntimeDependencies(dependencies, {
    gcsProviderKey: "gcsParserReaderProvider",
  }));
}
