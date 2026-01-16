import type { APITask } from "types/api_types";
import type { BoundingBoxObject } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";

export const NUM_TASKS_PER_BATCH = 100;
export type NewTask = {
  readonly boundingBox: BoundingBoxObject | null | undefined;
  readonly datasetId: string;
  readonly editPosition: Vector3;
  readonly editRotation: Vector3;
  readonly neededExperience: {
    readonly domain: string;
    readonly value: number;
  };
  readonly projectName: string;
  readonly scriptId: string | null | undefined;
  readonly pendingInstances: number;
  readonly taskTypeId: string;
  readonly csvFile?: File;
  readonly nmlFiles?: File[];
  readonly baseAnnotation?:
    | {
        baseId: string;
      }
    | null
    | undefined;
};

export type NewNmlTask = Pick<
  NewTask,
  | "taskTypeId"
  | "neededExperience"
  | "pendingInstances"
  | "projectName"
  | "scriptId"
  | "boundingBox"
>;

export type TaskCreationResponse = {
  status: number;
  success?: APITask;
  error?: string;
};

export type TaskCreationResponseContainer = {
  tasks: TaskCreationResponse[];
  warnings: string[];
};

export function normalizeFileEvent(
  event:
    | File[]
    | {
        fileList: File[];
      },
) {
  if (Array.isArray(event)) {
    return event;
  }

  return event?.fileList;
}
