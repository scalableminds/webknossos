import { Slider } from "components/slider";
import { V3 } from "libs/mjs";
import { clamp } from "libs/utils";
import { useCallback, useMemo } from "react";
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
  const allMags = useMemo(() => magnificationInfo.getMagsWithIndices(), [magnificationInfo]);

  const tooltipFormatter = useCallback(() => value.join("-"), [value]);
  const handleSliderChange = useCallback(
    (sliderValue: number) => {
      if (allMags[sliderValue]) {
        onChange(allMags[sliderValue][1]);
      }
    },
    [allMags, onChange],
  );

  return (
    <Slider
      tooltip={{
        formatter: tooltipFormatter,
      }}
      min={0}
      max={allMags.length - 1}
      step={1}
      value={clamp(
        0,
        allMags.findIndex(([, v]) => V3.equals(v, value)),
        allMags.length - 1,
      )}
      onChange={handleSliderChange}
      onWheelDisabled
    />
  );
}
