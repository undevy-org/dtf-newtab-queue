import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMutationLock } from "../src/mutationLock.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("mutationLock", () => {
  it("serializes concurrent mutations via the fallback tail when navigator.locks is absent", async () => {
    const lock = createMutationLock("test-lock");
    const order = [];
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();

    const firstMutation = lock(async () => {
      order.push("first-start");
      firstStarted.resolve();
      await releaseFirst.promise;
      order.push("first-end");
      return "first";
    });

    await firstStarted.promise;

    const secondMutation = lock(async () => {
      order.push("second-start");
      return "second";
    });

    assert.deepEqual(order, ["first-start"]);
    releaseFirst.resolve();

    const [firstResult, secondResult] = await Promise.all([firstMutation, secondMutation]);

    assert.equal(firstResult, "first");
    assert.equal(secondResult, "second");
    assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
  });

  it("releases the fallback tail after a rejected mutation", async () => {
    const lock = createMutationLock("test-lock-rejection");

    await assert.rejects(
      () => lock(async () => {
        throw new Error("mutation failed");
      }),
      /mutation failed/
    );

    const result = await lock(async () => "recovered");
    assert.equal(result, "recovered");
  });

  it("gives independently created locks independent serialization queues", async () => {
    const lockA = createMutationLock("lock-a");
    const lockB = createMutationLock("lock-b");
    const order = [];
    const releaseA = createDeferred();

    const mutationA = lockA(async () => {
      order.push("a-start");
      await releaseA.promise;
      order.push("a-end");
    });

    await Promise.resolve();

    const mutationB = lockB(async () => {
      order.push("b-start");
      order.push("b-end");
    });

    await mutationB;
    assert.deepEqual(order, ["a-start", "b-start", "b-end"]);

    releaseA.resolve();
    await mutationA;
    assert.deepEqual(order, ["a-start", "b-start", "b-end", "a-end"]);
  });

  it("delegates to an injected lock manager when one is available", async () => {
    const requestedNames = [];
    const fakeLockManager = {
      request(name, mutation) {
        requestedNames.push(name);
        return mutation();
      }
    };

    const lock = createMutationLock("web-locks-test", {
      getLockManager: () => fakeLockManager
    });
    const result = await lock(async () => "done");

    assert.equal(result, "done");
    assert.deepEqual(requestedNames, ["web-locks-test"]);
  });
});
