export function createMutationLock(lockName) {
  let fallbackMutationTail = Promise.resolve();

  return function withMutationLock(mutation) {
    const lockManager = globalThis.navigator?.locks;

    if (lockManager && typeof lockManager.request === "function") {
      return lockManager.request(lockName, mutation);
    }

    const result = fallbackMutationTail.then(mutation);
    fallbackMutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}
