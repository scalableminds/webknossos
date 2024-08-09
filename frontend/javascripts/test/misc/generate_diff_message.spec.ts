import test from "ava";
import { generateDiffMessage } from "dashboard/dataset/queries";

test("generateDiffMessage should produce a nice human-readable message (1)", (t) => {
  const expectedString = "";
  t.is(generateDiffMessage({ changed: 0, onlyInOld: 0, onlyInNew: 0 }), expectedString);
});

test("generateDiffMessage should produce a nice human-readable message (2)", (t) => {
  const expectedString = "There is 1 changed dataset.";
  t.is(generateDiffMessage({ changed: 1, onlyInOld: 0, onlyInNew: 0 }), expectedString);
});

test("generateDiffMessage should produce a nice human-readable message (3)", (t) => {
  const expectedString = "1 dataset no longer exists in this folder.";
  t.is(generateDiffMessage({ changed: 0, onlyInOld: 1, onlyInNew: 0 }), expectedString);
});

test("generateDiffMessage should produce a nice human-readable message (4)", (t) => {
  const expectedString = "There is 1 new dataset.";
  t.is(generateDiffMessage({ changed: 0, onlyInOld: 0, onlyInNew: 1 }), expectedString);
});

test("generateDiffMessage should produce a nice human-readable message (5)", (t) => {
  const expectedString = "There is 1 new dataset. Also, 1 dataset no longer exists in this folder.";
  t.is(generateDiffMessage({ changed: 0, onlyInOld: 1, onlyInNew: 1 }), expectedString);
});

test("generateDiffMessage should produce a nice human-readable message (6)", (t) => {
  const expectedString =
    "There are 1 new and 2 changed datasets. Also, 1 dataset no longer exists in this folder.";
  t.is(generateDiffMessage({ changed: 2, onlyInOld: 1, onlyInNew: 1 }), expectedString);
});

test("generateDiffMessage should produce a nice human-readable message (7)", (t) => {
  const expectedString = "There are 1 new and 2 changed datasets.";
  t.is(generateDiffMessage({ changed: 2, onlyInOld: 0, onlyInNew: 1 }), expectedString);
});

test("generateDiffMessage should produce a nice human-readable message (8)", (t) => {
  const expectedString =
    "There are 2 changed datasets. Also, 1 dataset no longer exists in this folder.";
  t.is(generateDiffMessage({ changed: 2, onlyInOld: 1, onlyInNew: 0 }), expectedString);
});
