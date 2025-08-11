import { Slider } from "components/slider";
import { V3 } from "libs/mjs";
import { clamp } from "libs/utils";
import type { Vector3 } from "viewer/constants";
import type { MagInfo } from "viewer/model/helpers/mag_info";

export function MagSlider({
  magnificationInfo,
  value,
  onChange,
}: {
  magnificationInfo: MagInfo;
  value: Vector3;
  onChange: (v: Vector3) => void;
}) {
  // Use `getMagsWithIndices` because returns a sorted list
  const allMags = magnificationInfo.getMagsWithIndices();

  return (
    <Slider
      tooltip={{
        formatter: () => value.join("-"),
      }}
      min={0}
      max={allMags.length - 1}
      step={1}
      value={clamp(
        0,
        allMags.findIndex(([, v]) => V3.equals(v, value)),
        allMags.length - 1,
      )}
      onChange={(value) => onChange(allMags[value][1])}
      onWheelDisabled
    />
  );
}
