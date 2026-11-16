import alignExample from "@images/align-example.png";
import alignStitchingExample from "@images/align-stitching-example.jpg";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrDatasetManager } from "libs/utils";
import type React from "react";
import { useCallback } from "react";
import { APIJobCommand } from "types/api_types";
import { JobSection } from "../components/job_section";
import { SelectableTile, TileGrid } from "../components/selectable_tile";
import { useAlignmentJobContext } from "./ai_alignment_job_context";

export type AlignmentTask = {
  name: string;
  comment: React.ReactNode;
  id: string;
  jobType: APIJobCommand | null;
  image: string;
  // Tasks with an href are not run from this modal, but link to another page instead.
  href?: string;
};

const alignmentTasks: AlignmentTask[] = [
  {
    name: "Align Sections",
    comment:
      "Aligns all sections of this dataset along the Z axis using features in neighboring sections. Only supported for datasets with a single tile per sections (no stitching needed).",
    id: "align-sections",
    jobType: APIJobCommand.ALIGN_SECTIONS,
    image: alignExample,
  },
  {
    name: "Align & stitch multiple tiles",
    comment:
      "For datasets with multiple tiles per section. Upload the tiles together with their positions as an alignment project to align and stitch them.",
    id: "align-tiles",
    jobType: null,
    href: "/alignmentProjects",
    image: alignStitchingExample,
  },
];

export const AiAlignmentModelSelector: React.FC = () => {
  const { selectedTask, setSelectedTask, stepStatuses } = useAlignmentJobContext();
  // Alignment projects are only accessible to admins and dataset managers.
  const canUseAlignmentProjects = useWkSelector((state) =>
    isUserAdminOrDatasetManager(state.activeUser),
  );

  const handleTaskSelection = useCallback(
    (item: AlignmentTask) => {
      if (item.jobType) {
        setSelectedTask(item);
      }
    },
    [setSelectedTask],
  );

  return (
    <JobSection
      step={1}
      title="Select Alignment Task"
      description="Choose based on how your sections were acquired."
      status={stepStatuses.task}
    >
      <TileGrid label="Alignment tasks">
        {alignmentTasks.map((task) => (
          <SelectableTile
            key={task.id}
            image={task.image}
            title={task.name}
            description={task.comment}
            href={task.href}
            isSelected={selectedTask?.id === task.id}
            isDisabled={task.href != null && !canUseAlignmentProjects}
            disabledLabel="Admins & dataset managers only"
            onSelect={() => handleTaskSelection(task)}
          />
        ))}
      </TileGrid>
    </JobSection>
  );
};
