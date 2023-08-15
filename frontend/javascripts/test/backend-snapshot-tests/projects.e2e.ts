import _ from "lodash";
import {
  tokenUserA,
  tokenUserD,
  setCurrToken,
  replaceVolatileValues,
  resetDatabase,
  writeTypeCheckingFile,
} from "test/enzyme/e2e-setup";
import type { APIProject, APIProjectUpdater } from "types/api_flow_types";
import * as api from "admin/admin_rest_api";
import test from "ava";
test.before("Reset database", async () => {
  resetDatabase();
});
test.beforeEach("Change token", async () => {
  setCurrToken(tokenUserA);
});
test.serial("getProjects()", async (t) => {
  const projects = _.sortBy(await api.getProjects(), (p) => p.name);

  writeTypeCheckingFile(projects, "project", "APIProject", {
    isArray: true,
  });
  t.snapshot(replaceVolatileValues(projects), {
    id: "projects-getProjects()",
  });
});
test.serial("getProjectsWithStatus()", async (t) => {
  const projects = _.sortBy(await api.getProjectsWithStatus(), (p) => p.name);

  t.snapshot(replaceVolatileValues(projects), {
    id: "projects-getProjectsWithStatus()",
  });
});
test.serial("getProject(projectId: string)", async (t) => {
  const projectId = _.sortBy(await api.getProjects(), (p) => p.name)[0].id;

  const project = await api.getProject(projectId);
  t.snapshot(replaceVolatileValues(project), {
    id: "projects-getProject(projectId: string)",
  });
});
test.serial("createProject and deleteProject", async (t) => {
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
  const createdProjectWithFixedId = Object.assign({}, createdProject, {
    id: "fixed-project-id",
  });
  t.snapshot(replaceVolatileValues(createdProjectWithFixedId), {
    id: "projects-createProject(project: APIProjectType)",
  });
  const response = await api.deleteProject(createdProject.id);
  t.snapshot(response, {
    id: "projects-deleteProject(projectId: string)",
  });
});

function convertProjectToProjectUpdater(project: APIProject): APIProjectUpdater {
  return Object.assign({}, project, {
    owner: project.owner.id,
  });
}

test.serial("updateProject(projectId: string, project: APIProjectType)", async (t) => {
  const project = (await api.getProjects())[0];
  const projectId = project.id;
  const projectWithOwnerId = convertProjectToProjectUpdater(project);
  const projectWithNewPriority: APIProjectUpdater = Object.assign({}, projectWithOwnerId, {
    priority: 1337,
  });
  const updatedProject = await api.updateProject(projectId, projectWithNewPriority);
  t.snapshot(replaceVolatileValues(updatedProject), {
    id: "projects-updateProject(projectId: string, project: APIProjectType)",
  });
  const revertedProject = await api.updateProject(projectId, projectWithOwnerId);
  t.snapshot(replaceVolatileValues(revertedProject), {
    id: "projects-revertedProject",
  });
});
test.serial("increaseProjectTaskInstances", async (t) => {
  await setCurrToken(tokenUserD);
  const projectId = (await api.getProjects())[0].id;
  const updatedProject = await api.increaseProjectTaskInstances(projectId, 10);
  t.snapshot(replaceVolatileValues(updatedProject), {
    id: "projects-increaseProjectTaskInstances(projectId: string, delta?: number)",
  });
});
test.serial("pauseProject and resumeProject", async (t) => {
  const projectId = (await api.getProjects())[0].id;
  const pausedProject = await api.pauseProject(projectId);
  t.snapshot(replaceVolatileValues(pausedProject), {
    id: "projects-pauseProject(projectId: string)",
  });
  const resumedProject = await api.resumeProject(projectId);
  t.snapshot(replaceVolatileValues(resumedProject), {
    id: "projects-resumeProject(projectId: string)",
  });
});
