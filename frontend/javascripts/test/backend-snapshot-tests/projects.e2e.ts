import _ from "lodash";
import {
  tokenUserA,
  tokenUserD,
  setUserAuthToken,
  replaceVolatileValues,
  resetDatabase,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import type { APIProject, APIProjectUpdater } from "types/api_types";
import {
  getProjects,
  getProjectsWithStatus,
  getProject,
  createProject,
  deleteProject,
  getTeams,
  getActiveUser,
  updateProject,
  increaseProjectTaskInstances,
  pauseProject,
  resumeProject,
} from "admin/rest_api";
import { describe, it, beforeAll, beforeEach } from "vitest";

describe("Project API (E2E)", () => {
  beforeAll(() => {
    resetDatabase();
  });

  beforeEach(() => {
    setUserAuthToken(tokenUserA);
  });

  it("getProjects()", async ({ expect }) => {
    const projects = _.sortBy(await getProjects(), (p) => p.name);

    writeTypeCheckingFile(projects, "project", "APIProject", {
      isArray: true,
    });

    expect(replaceVolatileValues(projects)).toMatchSnapshot();
  });

  it("getProjectsWithStatus()", async ({ expect }) => {
    const projects = _.sortBy(await getProjectsWithStatus(), (p) => p.name);

    expect(replaceVolatileValues(projects)).toMatchSnapshot();
  });

  it("getProject(projectId: string)", async ({ expect }) => {
    const projectId = _.sortBy(await getProjects(), (p) => p.name)[0].id;

    const project = await getProject(projectId);
    expect(replaceVolatileValues(project)).toMatchSnapshot();
  });

  it("createProject and deleteProject", async ({ expect }) => {
    const team = _.sortBy(await getTeams(), (aTeam) => aTeam.name)[0];

    const activeUser = await getActiveUser();
    const projectName = "test-new-project";
    const newProject = {
      name: projectName,
      team: team.id,
      teamName: team.name,
      owner: activeUser.id,
      priority: 1,
      paused: false,
      expectedTime: 1,
      pendingInstances: 1,
      isBlacklistedFromReport: true,
    };
    const createdProject = await createProject(newProject);

    // Since the id will change after re-runs, we fix it here for easy
    // snapshotting
    const createdProjectWithFixedId = Object.assign({}, createdProject);
    expect(replaceVolatileValues(createdProjectWithFixedId)).toMatchSnapshot();

    const response = await deleteProject(createdProject.id);
    expect(response).toMatchSnapshot();
  });

  function convertProjectToProjectUpdater(project: APIProject): APIProjectUpdater {
    return Object.assign({}, project, {
      owner: project.owner.id,
    });
  }

  it("updateProject(projectId: string, project: APIProjectType)", async ({ expect }) => {
    const project = (await getProjects())[0];
    const projectId = project.id;
    const projectWithOwnerId = convertProjectToProjectUpdater(project);
    const projectWithNewPriority: APIProjectUpdater = Object.assign({}, projectWithOwnerId, {
      priority: 1337,
    });

    const updatedProject = await updateProject(projectId, projectWithNewPriority);
    expect(replaceVolatileValues(updatedProject)).toMatchSnapshot();

    const revertedProject = await updateProject(projectId, projectWithOwnerId);
    expect(replaceVolatileValues(revertedProject)).toMatchSnapshot();
  });

  it("increaseProjectTaskInstances", async ({ expect }) => {
    await setUserAuthToken(tokenUserD);
    const projectId = (await getProjects())[0].id;
    const updatedProject = await increaseProjectTaskInstances(projectId, 10);

    expect(replaceVolatileValues(updatedProject)).toMatchSnapshot();
  });

  it("pauseProject and resumeProject", async ({ expect }) => {
    const projectId = (await getProjects())[0].id;

    const pausedProject = await pauseProject(projectId);
    expect(replaceVolatileValues(pausedProject)).toMatchSnapshot();

    const resumedProject = await resumeProject(projectId);
    expect(replaceVolatileValues(resumedProject)).toMatchSnapshot();
  });
});
