// @flow
import _ from "lodash";

import type { APIProject, APIProjectUpdater } from "types/api_flow_types";
import {
  tokenUserA,
  tokenUserD,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";

test.before("Reset database", async () => {
  resetDatabase();
});

test.beforeEach("Change token", async () => {
  setCurrToken(tokenUserA);
});

test.serial("getProjects()", async t => {
  const projects = _.sortBy(await api.getProjects(), p => p.name);
  writeFlowCheckingFile(projects, "project", "APIProject", { isArray: true });
  t.snapshot(projects, { id: "projects-getProjects()" });
});

test.serial("getProjectsWithOpenAssignments()", async t => {
  const projects = _.sortBy(await api.getProjectsWithOpenAssignments(), p => p.name);
  t.snapshot(projects, { id: "projects-getProjectsWithOpenAssignments()" });
});

test.serial("getProject(projectId: string)", async t => {
  const projectId = _.sortBy(await api.getProjects(), p => p.name)[0].id;
  const project = await api.getProject(projectId);
  t.snapshot(project, { id: "projects-getProject(projectId: string)" });
});

test.serial("createProject and deleteProject", async t => {
  const teamId = _.sortBy(await api.getTeams(), team => team.name)[0].id;
  const activeUser = await api.getActiveUser();
  const projectName = "test-new-project";
  const newProject = {
    name: projectName,
    team: teamId,
    owner: activeUser.id,
    priority: 1,
    paused: false,
    expectedTime: 1,
    numberOfOpenAssignments: 1,
    isBlacklistedFromReport: true,
  };

  const createdProject = await api.createProject(newProject);
  // Since the id will change after re-runs, we fix it here for easy
  // snapshotting
  const createdProjectWithFixedId = Object.assign({}, createdProject, { id: "fixed-project-id" });
  t.snapshot(createdProjectWithFixedId, { id: "projects-createProject(project: APIProjectType)" });

  const response = await api.deleteProject(createdProject.id);
  t.snapshot(response, { id: "projects-deleteProject(projectId: string)" });
});

function convertProjectToProjectUpdater(project: APIProject): APIProjectUpdater {
  // $FlowFixMe[incompatible-return]
  return Object.assign({}, project, {
    owner: project.owner.id,
  });
}

test.serial("updateProject(projectId: string, project: APIProjectType)", async t => {
  const project = (await api.getProjects())[0];
  const projectId = project.id;

  const projectWithOwnerId = convertProjectToProjectUpdater(project);

  const projectWithNewPriority: APIProjectUpdater = Object.assign({}, projectWithOwnerId, {
    priority: 1337,
  });

  const updatedProject = await api.updateProject(projectId, projectWithNewPriority);
  t.snapshot(updatedProject, {
    id: "projects-updateProject(projectId: string, project: APIProjectType)",
  });

  const revertedProject = await api.updateProject(projectId, projectWithOwnerId);
  t.snapshot(revertedProject, {
    id: "projects-revertedProject",
  });
});

test.serial("increaseProjectTaskInstances", async t => {
  await setCurrToken(tokenUserD);
  const projectId = (await api.getProjects())[0].id;

  const updatedProject = await api.increaseProjectTaskInstances(projectId, 10);
  t.snapshot(updatedProject, {
    id: "projects-increaseProjectTaskInstances(projectId: string, delta?: number)",
  });
});

test.serial("pauseProject and resumeProject", async t => {
  const projectId = (await api.getProjects())[0].id;

  const pausedProject = await api.pauseProject(projectId);
  t.snapshot(pausedProject, { id: "projects-pauseProject(projectId: string)" });

  const resumedProject = await api.resumeProject(projectId);
  t.snapshot(resumedProject, { id: "projects-resumeProject(projectId: string)" });
});
