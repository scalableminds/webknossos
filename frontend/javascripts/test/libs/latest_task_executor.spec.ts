import Deferred from "libs/async/deferred";
import { describe, it, expect } from "vitest";
import LatestTaskExecutor, { SKIPPED_TASK_REASON } from "libs/async/latest_task_executor";

describe("LatestTaskExecutor", () => {
  it("One task", async () => {
    const executor = new LatestTaskExecutor();
    const deferred1 = new Deferred();
    const scheduledPromise = executor.schedule(() => deferred1.promise());
    deferred1.resolve(true);
    const result = await scheduledPromise;
    expect(result).toBe(true);
  });

  it("two successive tasks", async () => {
    const executor = new LatestTaskExecutor();
    const deferred1 = new Deferred();
    const deferred2 = new Deferred();
    const scheduledPromise1 = executor.schedule(() => deferred1.promise());
    deferred1.resolve(1);
    const scheduledPromise2 = executor.schedule(() => deferred2.promise());
    deferred2.resolve(2);
    const result1 = await scheduledPromise1;
    expect(result1).toBe(1);
    const result2 = await scheduledPromise2;
    expect(result2).toBe(2);
  });

  it("two interleaving tasks", async () => {
    const executor = new LatestTaskExecutor();
    const deferred1 = new Deferred();
    const deferred2 = new Deferred();
    const scheduledPromise1 = executor.schedule(() => deferred1.promise());
    const scheduledPromise2 = executor.schedule(() => deferred2.promise());
    deferred1.resolve(1);
    deferred2.resolve(2);
    const result1 = await scheduledPromise1;
    expect(result1).toBe(1);
    const result2 = await scheduledPromise2;
    expect(result2).toBe(2);
  });

  it("three interleaving tasks", async () => {
    const executor = new LatestTaskExecutor<number>();
    const deferred1 = new Deferred<number, unknown>();
    const deferred2 = new Deferred<number, unknown>();
    const deferred3 = new Deferred<number, unknown>();
    const scheduledPromise1 = executor.schedule(() => deferred1.promise());
    const scheduledPromise2 = executor.schedule(() => deferred2.promise());
    const scheduledPromise3 = executor.schedule(() => deferred3.promise());
    deferred1.resolve(1);
    deferred2.resolve(2);
    deferred3.resolve(3);
    const result1 = await scheduledPromise1;
    expect(result1).toBe(1);

    await expect(scheduledPromise2).rejects.toThrowError(SKIPPED_TASK_REASON);

    const result3 = await scheduledPromise3;
    expect(result3).toBe(3);
  });
});
