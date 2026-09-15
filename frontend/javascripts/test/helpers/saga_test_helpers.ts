import type { ExpectStatic } from "vitest";

/**
 * Helper function to check if a saga yield produces the expected value
 * @param expect Vitest's expect assertion function
 * @param block The saga block result from calling next()
 * @param expected The expected value to match against
 */
export function expectValueDeepEqual(expect: ExpectStatic, block: any, expected: any) {
  expect(block.done).toBe(false);

  return expect(block.value).toEqual(expected);
}

/**
 * Helper function to execute a saga CALL effect
 * @param expect Vitest's expect assertion function
 * @param block The saga block result from calling next()
 * @returns The result of executing the function
 */
export function execCall(expect: ExpectStatic, block: any) {
  expect(block.done).toBe(false);
  expect(block.value.type).toBe("CALL");

  return block.value.payload.fn.apply(block.value.payload.context, block.value.payload.args);
}
