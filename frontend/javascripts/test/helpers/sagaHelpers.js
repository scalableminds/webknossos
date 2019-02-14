// @noflow
export function expectValueDeepEqual(t, block, expected) {
  t.false(block.done);
  return t.deepEqual(block.value, expected);
}

export function execCall(t, block) {
  t.false(block.done);
  t.truthy(block.value.CALL);
  return block.value.CALL.fn.apply(block.value.CALL.context, block.value.CALL.args);
}
