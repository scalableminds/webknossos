// Mock data and API for alignment projects. Replace with real REST calls once the backend exists.
import type { APIJobState } from "types/api_types";
import type { Vector3 } from "viewer/constants";

export enum AlignmentProjectTaskType {
  ALIGN_SECTIONS = "align_sections",
  ALIGN_AND_STITCH_TILES = "align_and_stitch_tiles",
}

export type APIAlignmentProjectRun = {
  readonly id: string;
  readonly taskType: AlignmentProjectTaskType;
  readonly sectionRange: { readonly first: number; readonly last: number };
  readonly state: APIJobState;
  readonly created: number;
  readonly ownerFirstName: string;
  readonly ownerLastName: string;
  readonly ownerEmail: string;
  readonly costInMilliCredits: number | null;
  readonly voxelyticsWorkflowHash: string | null;
  readonly outputDataset: { readonly id: string; readonly name: string } | null;
  readonly errorMessage: string | null;
};

export type APIAlignmentProject = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly created: number;
  readonly ownerFirstName: string;
  readonly ownerLastName: string;
  readonly dataStoreName: string;
  readonly voxelSize: Vector3;
  readonly csvFileName: string;
  // All uploaded files, including the CSV.
  readonly fileCount: number;
  // Auto-detected from the uploaded files (e.g. by the backend or worker).
  readonly detectedTaskType: AlignmentProjectTaskType;
  // Inclusive section numbers, extracted from the CSV.
  readonly sectionRange: { readonly first: number; readonly last: number };
  readonly totalSizeInBytes: number;
  // The uploaded files were deleted to free storage. Metadata and past runs are kept.
  readonly isInputDataDeleted: boolean;
  readonly runs: APIAlignmentProjectRun[];
};

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const owner = {
  ownerFirstName: "Sample",
  ownerLastName: "User",
  ownerEmail: "sample@scm.io",
};

let mockProjects: APIAlignmentProject[] = [
  {
    id: "6708f1a2c3d4e5f600000001",
    name: "Mouse Cortex L4 – Serial Sections",
    description:
      "Serial section EM of mouse somatosensory cortex, layer 4. 1,200 sections imaged with a 3×3 tile mosaic each on the MultiSEM.",
    created: now - 21 * DAY,
    ownerFirstName: "Sample",
    ownerLastName: "User",
    dataStoreName: "localhost",
    voxelSize: [4, 4, 35],
    csvFileName: "mouse_cortex_l4_tiles.csv",
    fileCount: 10_801,
    detectedTaskType: AlignmentProjectTaskType.ALIGN_AND_STITCH_TILES,
    sectionRange: { first: 0, last: 1199 },
    totalSizeInBytes: 1.62 * 1024 ** 4,
    isInputDataDeleted: false,
    runs: [
      {
        id: "6708f1a2c3d4e5f6000000a1",
        taskType: AlignmentProjectTaskType.ALIGN_AND_STITCH_TILES,
        sectionRange: { first: 0, last: 1199 },
        state: "SUCCESS",
        created: now - 19 * DAY,
        ...owner,
        costInMilliCredits: 412_500,
        voxelyticsWorkflowHash: "a1b2c3d4e5f6",
        outputDataset: { id: "6708f1a2c3d4e5f6000000d1", name: "mouse_cortex_l4_aligned_v1" },
        errorMessage: null,
      },
      {
        id: "6708f1a2c3d4e5f6000000a2",
        taskType: AlignmentProjectTaskType.ALIGN_AND_STITCH_TILES,
        sectionRange: { first: 0, last: 199 },
        state: "FAILURE",
        created: now - 12 * DAY,
        ...owner,
        costInMilliCredits: null,
        voxelyticsWorkflowHash: "b2c3d4e5f6a7",
        outputDataset: null,
        errorMessage: "Could not find tile file sections/0417/tile_2_1.tif referenced in CSV.",
      },
      {
        id: "6708f1a2c3d4e5f6000000a3",
        taskType: AlignmentProjectTaskType.ALIGN_AND_STITCH_TILES,
        sectionRange: { first: 0, last: 1199 },
        state: "STARTED",
        created: now - 2 * 60 * 60 * 1000,
        ...owner,
        costInMilliCredits: 414_720,
        voxelyticsWorkflowHash: "c3d4e5f6a7b8",
        outputDataset: null,
        errorMessage: null,
      },
    ],
  },
  {
    id: "6708f1a2c3d4e5f600000002",
    name: "Zebrafish Larva Hindbrain",
    description: "Single-tile ssTEM sections of a 6 dpf zebrafish larva hindbrain.",
    created: now - 7 * DAY,
    ownerFirstName: "Jane",
    ownerLastName: "Doe",
    dataStoreName: "localhost",
    voxelSize: [8, 8, 50],
    csvFileName: "zf_hindbrain_sections.csv",
    fileCount: 641,
    detectedTaskType: AlignmentProjectTaskType.ALIGN_SECTIONS,
    sectionRange: { first: 1, last: 640 },
    totalSizeInBytes: 96 * 1024 ** 3,
    isInputDataDeleted: false,
    runs: [
      {
        id: "6708f1a2c3d4e5f6000000b1",
        taskType: AlignmentProjectTaskType.ALIGN_SECTIONS,
        sectionRange: { first: 1, last: 640 },
        state: "SUCCESS",
        created: now - 6 * DAY,
        ownerFirstName: "Jane",
        ownerLastName: "Doe",
        ownerEmail: "jane.doe@example.com",
        costInMilliCredits: 38_200,
        voxelyticsWorkflowHash: "d4e5f6a7b8c9",
        outputDataset: { id: "6708f1a2c3d4e5f6000000d2", name: "zf_hindbrain_aligned" },
        errorMessage: null,
      },
      {
        id: "6708f1a2c3d4e5f6000000b2",
        taskType: AlignmentProjectTaskType.ALIGN_SECTIONS,
        sectionRange: { first: 1, last: 320 },
        state: "STARTED",
        created: now - 25 * 60 * 1000,
        ownerFirstName: "Jane",
        ownerLastName: "Doe",
        ownerEmail: "jane.doe@example.com",
        costInMilliCredits: 19_200,
        voxelyticsWorkflowHash: "e5f6a7b8c9d0",
        outputDataset: null,
        errorMessage: null,
      },
    ],
  },
  {
    id: "6708f1a2c3d4e5f600000003",
    name: "Drosophila VNC Pilot",
    description: "",
    created: now - 1 * DAY,
    ownerFirstName: "Sample",
    ownerLastName: "User",
    dataStoreName: "localhost",
    voxelSize: [8, 8, 40],
    csvFileName: "vnc_pilot.csv",
    fileCount: 257,
    detectedTaskType: AlignmentProjectTaskType.ALIGN_AND_STITCH_TILES,
    sectionRange: { first: 100, last: 163 },
    totalSizeInBytes: 12.4 * 1024 ** 3,
    isInputDataDeleted: false,
    runs: [],
  },
];

const simulateLatency = () => new Promise((resolve) => setTimeout(resolve, 300));

export async function getAlignmentProjects(): Promise<APIAlignmentProject[]> {
  await simulateLatency();
  return mockProjects;
}

export async function getAlignmentProject(id: string): Promise<APIAlignmentProject> {
  await simulateLatency();
  const project = mockProjects.find((p) => p.id === id);
  if (project == null) throw new Error(`Alignment project ${id} not found.`);
  return project;
}

export async function createAlignmentProject(
  project: Pick<
    APIAlignmentProject,
    | "name"
    | "description"
    | "dataStoreName"
    | "voxelSize"
    | "csvFileName"
    | "fileCount"
    | "totalSizeInBytes"
  >,
): Promise<APIAlignmentProject> {
  await simulateLatency();
  const newProject: APIAlignmentProject = {
    ...project,
    detectedTaskType: AlignmentProjectTaskType.ALIGN_AND_STITCH_TILES,
    sectionRange: { first: 0, last: 99 },
    isInputDataDeleted: false,
    id: Math.random().toString(16).slice(2, 14).padEnd(24, "0"),
    created: Date.now(),
    ownerFirstName: owner.ownerFirstName,
    ownerLastName: owner.ownerLastName,
    runs: [],
  };
  mockProjects = [newProject, ...mockProjects];
  return newProject;
}

export async function updateAlignmentProject(
  id: string,
  update: Partial<Pick<APIAlignmentProject, "name" | "description" | "voxelSize">>,
): Promise<void> {
  await simulateLatency();
  mockProjects = mockProjects.map((p) => (p.id === id ? { ...p, ...update } : p));
}

export async function deleteAlignmentProjectInputData(id: string): Promise<void> {
  await simulateLatency();
  mockProjects = mockProjects.map((p) =>
    p.id === id
      ? {
          ...p,
          isInputDataDeleted: true,
          runs: p.runs.map((run) =>
            run.state === "PENDING" || run.state === "STARTED"
              ? { ...run, state: "CANCELLED" }
              : run,
          ),
        }
      : p,
  );
}

export async function deleteAlignmentProject(id: string): Promise<void> {
  await simulateLatency();
  mockProjects = mockProjects.filter((p) => p.id !== id);
}

export type AlignmentRunSettings = {
  newDatasetName: string;
  shouldRenderUnalignedPreview: boolean;
  // Inclusive section numbers. null means all sections.
  sectionRange: [number, number] | null;
  customConfiguration: Record<string, unknown>;
};

export async function startAlignmentProjectJob(
  projectId: string,
  taskType: AlignmentProjectTaskType,
  settings: AlignmentRunSettings,
): Promise<void> {
  await simulateLatency();
  const project = mockProjects.find((p) => p.id === projectId);
  const run: APIAlignmentProjectRun = {
    id: Math.random().toString(16).slice(2, 14).padEnd(24, "0"),
    taskType,
    sectionRange:
      settings.sectionRange != null
        ? { first: settings.sectionRange[0], last: settings.sectionRange[1] }
        : (project?.sectionRange ?? { first: 0, last: 0 }),
    state: "PENDING",
    created: Date.now(),
    ...owner,
    // Credits are charged when the job is started.
    costInMilliCredits: project
      ? getMockAlignmentCostInMilliCredits(project, taskType, settings.sectionRange)
      : null,
    voxelyticsWorkflowHash: null,
    outputDataset: null,
    errorMessage: null,
  };
  mockProjects = mockProjects.map((p) =>
    p.id === projectId ? { ...p, runs: [...p.runs, run] } : p,
  );
}

export async function cancelAlignmentProjectRun(projectId: string, runId: string): Promise<void> {
  await simulateLatency();
  mockProjects = mockProjects.map((p) =>
    p.id === projectId
      ? {
          ...p,
          runs: p.runs.map((run) =>
            run.id === runId ? { ...run, state: "CANCELLED" as const } : run,
          ),
        }
      : p,
  );
}

// Rough mock pricing: credits scale with the uploaded data volume.
export const MOCK_MILLI_CREDITS_PER_GIGABYTE: Record<AlignmentProjectTaskType, number> = {
  [AlignmentProjectTaskType.ALIGN_SECTIONS]: 400,
  [AlignmentProjectTaskType.ALIGN_AND_STITCH_TILES]: 250,
};

export function getSectionCount(range: { first: number; last: number }): number {
  return range.last - range.first + 1;
}

export function getMockCostPerSectionInMilliCredits(
  project: APIAlignmentProject,
  taskType: AlignmentProjectTaskType,
): number {
  const totalCost =
    (project.totalSizeInBytes / 1024 ** 3) * MOCK_MILLI_CREDITS_PER_GIGABYTE[taskType];
  return totalCost / getSectionCount(project.sectionRange);
}

export function getMockAlignmentCostInMilliCredits(
  project: APIAlignmentProject,
  taskType: AlignmentProjectTaskType,
  sectionRange: [number, number] | null,
): number {
  const sectionCount =
    sectionRange == null
      ? getSectionCount(project.sectionRange)
      : getSectionCount({ first: sectionRange[0], last: sectionRange[1] });
  return Math.round(getMockCostPerSectionInMilliCredits(project, taskType) * sectionCount);
}

export function getAlignmentProjectTaskTypeName(taskType: AlignmentProjectTaskType): string {
  return taskType === AlignmentProjectTaskType.ALIGN_SECTIONS
    ? "Align Sections"
    : "Align & Stitch Tiles";
}
