const OPERATION_NAMES = Object.freeze([
  "createReservedUploadLifecycle",
  "getUploadLifecycle",
  "transitionUploadLifecycle",
]);

export function createUploadLifecycleRepository(operations) {
  if (!operations || typeof operations !== "object" || Array.isArray(operations)) {
    throw new TypeError("Upload lifecycle repository operations are required.");
  }

  const operationNames = Object.keys(operations);
  const hasExactOperationSet =
    operationNames.length === OPERATION_NAMES.length &&
    OPERATION_NAMES.every((name) => typeof operations[name] === "function");

  if (!hasExactOperationSet) {
    throw new TypeError("Upload lifecycle repository exposes an invalid operation set.");
  }

  return Object.freeze({
    createReservedUploadLifecycle: operations.createReservedUploadLifecycle,
    getUploadLifecycle: operations.getUploadLifecycle,
    transitionUploadLifecycle: operations.transitionUploadLifecycle,
  });
}
