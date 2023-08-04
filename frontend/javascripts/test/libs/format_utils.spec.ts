import test from "ava";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";
import { Unicode } from "oxalis/constants";

test("Format number to length", (t) => {
  const { ThinSpace } = Unicode;
  const lengthsInNm = [107e-3, 107, 107e3, 107e6, 107e9, 107e12];
  t.deepEqual(
    [
      `107${ThinSpace}pm`,
      `107${ThinSpace}nm`,
      `107${ThinSpace}µm`,
      `107${ThinSpace}mm`,
      `107${ThinSpace}m`,
      `107${ThinSpace}km`,
    ],
    lengthsInNm.map((length) => formatNumberToLength(length)),
  );
});

test("Format number to area", (t) => {
  const { ThinSpace } = Unicode;
  const lengthsInNm = [107e-6, 107, 107e6, 107e12, 107e18, 107e24];
  t.deepEqual(
    [
      `107${ThinSpace}pm²`,
      `107${ThinSpace}nm²`,
      `107${ThinSpace}µm²`,
      `107${ThinSpace}mm²`,
      `107${ThinSpace}m²`,
      `107${ThinSpace}km²`,
    ],
    lengthsInNm.map((length) => formatNumberToArea(length)),
  );
});

test("Format number to volume", (t) => {
  const { ThinSpace } = Unicode;
  const lengthsInNm = [107e-9, 107, 107e9, 107e18, 107e27, 107e36];
  t.deepEqual(
    [
      `107${ThinSpace}pm³`,
      `107${ThinSpace}nm³`,
      `107${ThinSpace}µm³`,
      `107${ThinSpace}mm³`,
      `107${ThinSpace}m³`,
      `107${ThinSpace}km³`,
    ],
    lengthsInNm.map((length) => formatNumberToVolume(length)),
  );
});
