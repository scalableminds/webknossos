// @noflow
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 't' implicitly has an 'any' type.
export function expectValueDeepEqual(t, block, expected) {
  t.false(block.done);
  return t.deepEqual(block.value, expected);
}
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 't' implicitly has an 'any' type.
export function execCall(t, block) {
  t.false(block.done);
  t.is(block.value.type, "CALL");
  return block.value.payload.fn.apply(block.value.payload.context, block.value.payload.args);
}
