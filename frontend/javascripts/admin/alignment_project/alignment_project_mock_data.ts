// Mock data and API for alignment projects. Replace with real REST calls once the backend exists.
import type { APIJobState } from "types/api_types";
import { UnitLong, type Vector3 } from "viewer/constants";

export type SectionRange = { readonly first: number; readonly last: number };

export type APIAlignmentProjectRun = {
  readonly id: string;
  // Renders the input data without aligning it. Cheaper than an alignment.
  readonly renderUnaligned: boolean;
  readonly sectionRange: SectionRange;
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

// UPLOADING: upload not finished yet. INVALID: the CSV could not be parsed.
export type AlignmentProjectStatus = "UPLOADING" | "READY" | "INVALID";

export type APIAlignmentProject = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: AlignmentProjectStatus;
  readonly invalidReason: string | null;
  readonly created: number;
  readonly ownerFirstName: string;
  readonly ownerLastName: string;
  readonly dataStoreName: string;
  readonly voxelSize: Vector3;
  readonly voxelSizeUnit: UnitLong;
  readonly csvFileName: string;
  // All uploaded files, including the CSV.
  readonly fileCount: number;
  // Inclusive section numbers, extracted from the CSV. null unless the project is READY.
  readonly sectionRange: SectionRange | null;
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

const janeDoe = {
  ownerFirstName: "Jane",
  ownerLastName: "Doe",
  ownerEmail: "jane.doe@example.com",
};

let mockProjects: APIAlignmentProject[] = [
  {
    id: "6708f1a2c3d4e5f600000001",
    name: "Mouse Cortex L4 – Serial Sections",
    description:
      "Serial section EM of mouse somatosensory cortex, layer 4. 1,200 sections imaged with a 3×3 tile mosaic each on the MultiSEM.",
    status: "READY",
    invalidReason: null,
    created: now - 21 * DAY,
    ownerFirstName: owner.ownerFirstName,
    ownerLastName: owner.ownerLastName,
    dataStoreName: "localhost",
    voxelSize: [4, 4, 35],
    voxelSizeUnit: UnitLong.nm,
    csvFileName: "mouse_cortex_l4_tiles.csv",
    fileCount: 10_801,
    sectionRange: { first: 0, last: 1199 },
    totalSizeInBytes: 1.62 * 1024 ** 4,
    isInputDataDeleted: false,
    runs: [
      {
        id: "6708f1a2c3d4e5f6000000a0",
        renderUnaligned: true,
        sectionRange: { first: 0, last: 1199 },
        state: "SUCCESS",
        created: now - 20 * DAY,
        ...owner,
        costInMilliCredits: 82_944,
        voxelyticsWorkflowHash: "f0e1d2c3b4a5",
        outputDataset: { id: "6708f1a2c3d4e5f6000000d0", name: "mouse_cortex_l4_unaligned" },
        errorMessage: null,
      },
      {
        id: "6708f1a2c3d4e5f6000000a1",
        renderUnaligned: false,
        sectionRange: { first: 0, last: 1199 },
        state: "SUCCESS",
        created: now - 19 * DAY,
        ...owner,
        costInMilliCredits: 497_664,
        voxelyticsWorkflowHash: "a1b2c3d4e5f6",
        outputDataset: { id: "6708f1a2c3d4e5f6000000d1", name: "mouse_cortex_l4_aligned_v1" },
        errorMessage: null,
      },
      {
        id: "6708f1a2c3d4e5f6000000a2",
        renderUnaligned: false,
        sectionRange: { first: 0, last: 199 },
        state: "FAILURE",
        created: now - 12 * DAY,
        ...owner,
        costInMilliCredits: null,
        voxelyticsWorkflowHash: "b2c3d4e5f6a7",
        outputDataset: null,
        errorMessage: "Could not find tile file sections/0117/tile_2_1.tif referenced in CSV.",
      },
      {
        id: "6708f1a2c3d4e5f6000000a3",
        renderUnaligned: false,
        sectionRange: { first: 0, last: 1199 },
        state: "STARTED",
        created: now - 2 * 60 * 60 * 1000,
        ...owner,
        costInMilliCredits: 497_664,
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
    status: "READY",
    invalidReason: null,
    created: now - 7 * DAY,
    ownerFirstName: janeDoe.ownerFirstName,
    ownerLastName: janeDoe.ownerLastName,
    dataStoreName: "localhost",
    voxelSize: [8, 8, 50],
    voxelSizeUnit: UnitLong.nm,
    csvFileName: "zf_hindbrain_sections.csv",
    fileCount: 641,
    sectionRange: { first: 1, last: 640 },
    totalSizeInBytes: 96 * 1024 ** 3,
    isInputDataDeleted: false,
    runs: [
      {
        id: "6708f1a2c3d4e5f6000000b1",
        renderUnaligned: false,
        sectionRange: { first: 1, last: 640 },
        state: "SUCCESS",
        created: now - 6 * DAY,
        ...janeDoe,
        costInMilliCredits: 28_800,
        voxelyticsWorkflowHash: "d4e5f6a7b8c9",
        outputDataset: { id: "6708f1a2c3d4e5f6000000d2", name: "zf_hindbrain_aligned" },
        errorMessage: null,
      },
      {
        id: "6708f1a2c3d4e5f6000000b2",
        renderUnaligned: false,
        sectionRange: { first: 1, last: 320 },
        state: "STARTED",
        created: now - 25 * 60 * 1000,
        ...janeDoe,
        costInMilliCredits: 14_400,
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
    status: "READY",
    invalidReason: null,
    created: now - 1 * DAY,
    ownerFirstName: owner.ownerFirstName,
    ownerLastName: owner.ownerLastName,
    dataStoreName: "localhost",
    voxelSize: [8, 8, 40],
    voxelSizeUnit: UnitLong.nm,
    csvFileName: "vnc_pilot.csv",
    fileCount: 257,
    sectionRange: { first: 100, last: 163 },
    totalSizeInBytes: 12.4 * 1024 ** 3,
    isInputDataDeleted: false,
    runs: [],
  },
  {
    id: "6708f1a2c3d4e5f600000004",
    name: "Mouse Hippocampus CA1",
    description: "Second batch from the hippocampus series.",
    status: "INVALID",
    invalidReason:
      "Could not parse mouse_ca1_tiles.csv: section numbers are not continuous (section 57 is followed by 59).",
    created: now - 3 * DAY,
    ownerFirstName: janeDoe.ownerFirstName,
    ownerLastName: janeDoe.ownerLastName,
    dataStoreName: "localhost",
    voxelSize: [4, 4, 30],
    voxelSizeUnit: UnitLong.nm,
    csvFileName: "mouse_ca1_tiles.csv",
    fileCount: 2_305,
    sectionRange: null,
    totalSizeInBytes: 340 * 1024 ** 3,
    isInputDataDeleted: false,
    runs: [],
  },
  {
    id: "6708f1a2c3d4e5f600000005",
    name: "Human Cortex Biopsy",
    description: "",
    status: "UPLOADING",
    invalidReason: null,
    created: now - 40 * 60 * 1000,
    ownerFirstName: owner.ownerFirstName,
    ownerLastName: owner.ownerLastName,
    dataStoreName: "localhost",
    voxelSize: [5, 5, 30],
    voxelSizeUnit: UnitLong.nm,
    csvFileName: "biopsy_tiles.csv",
    fileCount: 4_097,
    sectionRange: null,
    totalSizeInBytes: 610 * 1024 ** 3,
    isInputDataDeleted: false,
    runs: [],
  },
];

const simulateLatency = () => new Promise((resolve) => setTimeout(resolve, 300));

const createMockId = () => Math.random().toString(16).slice(2, 14).padEnd(24, "0");

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
    | "voxelSizeUnit"
    | "csvFileName"
    | "fileCount"
    | "totalSizeInBytes"
  >,
): Promise<APIAlignmentProject> {
  await simulateLatency();
  if (mockProjects.some((p) => p.name === project.name)) {
    throw new Error(`An alignment project named "${project.name}" already exists.`);
  }
  // Pretend that the upload finished and the datastore extracted the section range from the CSV.
  const newProject: APIAlignmentProject = {
    ...project,
    status: "READY",
    invalidReason: null,
    sectionRange: { first: 0, last: 99 },
    isInputDataDeleted: false,
    id: createMockId(),
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
  update: Partial<
    Pick<APIAlignmentProject, "name" | "description" | "voxelSize" | "voxelSizeUnit">
  >,
): Promise<void> {
  await simulateLatency();
  if (update.name != null && mockProjects.some((p) => p.id !== id && p.name === update.name)) {
    throw new Error(`An alignment project named "${update.name}" already exists.`);
  }
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
  // null means the organization's root folder.
  folderId: string | null;
  renderUnaligned: boolean;
  // null means all sections.
  sectionRange: SectionRange | null;
};

export async function startAlignmentProjectJob(
  projectId: string,
  settings: AlignmentRunSettings,
): Promise<void> {
  await simulateLatency();
  const project = mockProjects.find((p) => p.id === projectId);
  if (project?.sectionRange == null) throw new Error("Alignment project is not ready.");
  const sectionRange = settings.sectionRange ?? project.sectionRange;
  const run: APIAlignmentProjectRun = {
    id: createMockId(),
    renderUnaligned: settings.renderUnaligned,
    sectionRange,
    state: "PENDING",
    created: Date.now(),
    ...owner,
    // Credits are charged when the job is started.
    costInMilliCredits: getMockAlignmentCostInMilliCredits(
      project,
      settings.renderUnaligned,
      sectionRange,
    ),
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

// Mock pricing per gigabyte of input data. Rendering unaligned is cheaper than aligning.
const MOCK_MILLI_CREDITS_PER_GIGABYTE = { align: 300, renderUnaligned: 50 };

export function getSectionCount(range: SectionRange): number {
  return range.last - range.first + 1;
}

export function formatSectionRange(range: SectionRange): string {
  return `${range.first}–${range.last} (${getSectionCount(range).toLocaleString()})`;
}

// Assumes that the data size is roughly uniform across sections.
export function getMockCostPerSectionInMilliCredits(
  project: APIAlignmentProject,
  renderUnaligned: boolean,
): number {
  if (project.sectionRange == null) return 0;
  const pricePerGigabyte = renderUnaligned
    ? MOCK_MILLI_CREDITS_PER_GIGABYTE.renderUnaligned
    : MOCK_MILLI_CREDITS_PER_GIGABYTE.align;
  const totalCost = (project.totalSizeInBytes / 1024 ** 3) * pricePerGigabyte;
  return totalCost / getSectionCount(project.sectionRange);
}

export function getMockAlignmentCostInMilliCredits(
  project: APIAlignmentProject,
  renderUnaligned: boolean,
  sectionRange: SectionRange,
): number {
  return Math.round(
    getMockCostPerSectionInMilliCredits(project, renderUnaligned) * getSectionCount(sectionRange),
  );
}

export function getAlignmentRunTypeName(renderUnaligned: boolean): string {
  return renderUnaligned ? "Render Unaligned" : "Align";
}
