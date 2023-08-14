import { call, type Saga } from "oxalis/model/sagas/effect-generators";
import { runSaga } from "redux-saga";
import { sleep } from "libs/utils";
import test from "ava";

export default function* reentrable(): Saga<void> {
  console.log("start");
  yield* call(sleep, 500);
  console.log("after sleep");
}

test.serial("processTaskWithPool should run a simple task", async (t) => {
  t.plan(1);
  const protocol: number[] = [];

  const task = runSaga({}, reentrable);
  task.cancel();
  await task.toPromise();
  t.is(protocol.length, 0);
});
