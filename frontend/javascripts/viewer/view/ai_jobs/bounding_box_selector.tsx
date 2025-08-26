import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useMemo } from "react";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import type { UserBoundingBox } from "viewer/store";
import { BoundingBoxSelection } from "viewer/view/action-bar/ai_job_modals/components/bounding_box_selection";
import { getBoundingBoxesForLayers } from "viewer/view/action-bar/ai_job_modals/utils";

interface BoundingBoxSelectorProps {
  value?: UserBoundingBox | null;
  onChange?: (value: UserBoundingBox | null) => void;
}

export const BoundingBoxSelector: React.FC<BoundingBoxSelectorProps> = ({ value, onChange }) => {
  const userBoundingBoxes = useWkSelector(getUserBoundingBoxesFromState);
  const dataset = useWkSelector((state) => state.dataset);
  const colorLayers = getColorLayers(dataset);

  const allBoundingBoxes = useMemo(() => {
    const defaultBBs = getBoundingBoxesForLayers(colorLayers);
    return defaultBBs.concat(userBoundingBoxes);
  }, [colorLayers, userBoundingBoxes]);

  const handleChange = (id: number | null) => {
    const selected = allBoundingBoxes.find((bb) => bb.id === id) || null;
    onChange(selected);
  };

  return (
    <BoundingBoxSelection
      userBoundingBoxes={allBoundingBoxes}
      setSelectedBoundingBoxId={handleChange}
      value={value?.id ?? null}
      showVolume
    />
  );
};
