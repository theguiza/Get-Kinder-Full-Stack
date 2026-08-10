const signal = new Error("Repository idempotent write conflict.");
signal.name = "KaiIdempotentWriteConflict";

/**
 * Exact-identity, repository-neutral signal for an idempotent write conflict.
 * Repository implementations must throw this singleton unchanged; consumers
 * must not infer this condition from database codes, names, messages, or shape.
 */
export const kaiIdempotentWriteConflict = Object.freeze(signal);
