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
import * as api from "admin/admin_rest_api";
import { describe, it, beforeAll, beforeEach } from "vitest";

describe("Project API (E2E)", () => {
  beforeAll(() => {
    resetDatabase();
  });

  beforeEach(() => {
    setUserAuthToken(tokenUserA);
  });

  it("getProjects()", async ({ expect }) => {
    const projects = _.sortBy(await api.getProjects(), (p) => p.name);

    writeTypeCheckingFile(projects, "project", "APIProject", {
      isArray: true,
    });

    expect(replaceVolatileValues(projects)).toMatchSnapshot();
  });

  it("getProjectsWithStatus()", async ({ expect }) => {
    const projects = _.sortBy(await api.getProjectsWithStatus(), (p) => p.name);

    expect(replaceVolatileValues(projects)).toMatchSnapshot();
  });

  it("getProject(projectId: string)", async ({ expect }) => {
    const projectId = _.sortBy(await api.getProjects(), (p) => p.name)[0].id;

    const project = await api.getProject(projectId);
    expect(replaceVolatileValues(project)).toMatchSnapshot();
  });

  it("createProject and deleteProject", async ({ expect }) => {
    const team = _.sortBy(await api.getTeams(), (aTeam) => aTeam.name)[0];

    const activeUser = await api.getActiveUser();
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
    const createdProject = await api.createProject(newProject);

    // Since the id will change after re-runs, we fix it here for easy
    // snapshotting
    const createdProjectWithFixedId = Object.assign({}, createdProject);
    expect(replaceVolatileValues(createdProjectWithFixedId)).toMatchSnapshot();

    const response = await api.deleteProject(createdProject.id);
    expect(response).toMatchSnapshot();
  });

  function convertProjectToProjectUpdater(project: APIProject): APIProjectUpdater {
    return Object.assign({}, project, {
      owner: project.owner.id,
    });
  }

  it("updateProject(projectId: string, project: APIProjectType)", async ({ expect }) => {
    const project = (await api.getProjects())[0];
    const projectId = project.id;
    const projectWithOwnerId = convertProjectToProjectUpdater(project);
    const projectWithNewPriority: APIProjectUpdater = Object.assign({}, projectWithOwnerId, {
      priority: 1337,
    });

    const updatedProject = await api.updateProject(projectId, projectWithNewPriority);
    expect(replaceVolatileValues(updatedProject)).toMatchSnapshot();

    const revertedProject = await api.updateProject(projectId, projectWithOwnerId);
    expect(replaceVolatileValues(revertedProject)).toMatchSnapshot();
  });

  it("increaseProjectTaskInstances", async ({ expect }) => {
    await setUserAuthToken(tokenUserD);
    const projectId = (await api.getProjects())[0].id;
    const updatedProject = await api.increaseProjectTaskInstances(projectId, 10);

    expect(replaceVolatileValues(updatedProject)).toMatchSnapshot();
  });

  it("pauseProject and resumeProject", async ({ expect }) => {
    const projectId = (await api.getProjects())[0].id;

    const pausedProject = await api.pauseProject(projectId);
    expect(replaceVolatileValues(pausedProject)).toMatchSnapshot();

    const resumedProject = await api.resumeProject(projectId);
    expect(replaceVolatileValues(resumedProject)).toMatchSnapshot();
  });
});
