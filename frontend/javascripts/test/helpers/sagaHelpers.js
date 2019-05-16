// @noflow
export function expectValueDeepEqual(t, block, expected) {
  t.false(block.done);
  return t.deepEqual(block.value, expected);
}

export function execCall(t, block) {
  t.false(block.done);
  t.is(block.value.type, "CALL");
  return block.value.payload.fn.apply(block.value.payload.context, block.value.payload.args);
}
