/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import * as api from "admin/admin_rest_api";
import type { APIProjectType, APIProjectUpdaterType, APIUserType } from "admin/api_flow_types";

test.serial("getProjects()", async t => {
  const projects = _.sortBy(await api.getProjects(), p => p.name);
  t.snapshot(projects, { id: "projects-getProjects()" });
});

test.serial("getProjectsWithOpenAssignments()", async t => {
  const projects = _.sortBy(await api.getProjectsWithOpenAssignments(), p => p.name);
  t.snapshot(projects, { id: "projects-getProjectsWithOpenAssignments()" });
});

test.serial("getProject(projectName: string)", async t => {
  const projectName = _.sortBy(await api.getProjects(), p => p.name)[0].name;
  const project = await api.getProject(projectName);
  t.snapshot(project, { id: "projects-getProject(projectName: string)" });
});

test.serial("createProject and deleteProject", async t => {
  const teamName = _.sortBy(await api.getTeams(), t => t.name)[0].name;
  const activeUser = await api.getActiveUser();
  const projectName = "test-new-project";
  const newProject = {
    name: projectName,
    team: teamName,
    owner: activeUser.id,
    priority: 1,
    paused: false,
    expectedTime: 1,
    numberOfOpenAssignments: 1,
  };

  const createdProject = await api.createProject(newProject);
  // Since the id will change after re-runs, we fix it here for easy
  // snapshotting
  const createdProjectWithFixedId = Object.assign({}, createdProject, { id: "fixed-project-id" });
  t.snapshot(createdProjectWithFixedId, { id: "projects-createProject(project: APIProjectType)" });

  const response = await api.deleteProject(projectName);
  t.snapshot(response, { id: "projects-deleteProject(projectName: string)" });
});

function convertProjectToProjectUpdater(project: APIProjectType): APIProjectUpdaterType {
  // $FlowFixMe
  return Object.assign({}, project, {
    owner: project.owner.id,
  });
}

test.serial("updateProject(projectName: string, project: APIProjectType)", async t => {
  const project = (await api.getProjects())[0];
  const projectName = project.name;

  const projectWithOwnerId = convertProjectToProjectUpdater(project);

  const projectWithNewPriority: APIProjectUpdaterType = Object.assign({}, projectWithOwnerId, {
    priority: 1337,
  });

  const updatedProject = await api.updateProject(projectName, projectWithNewPriority);
  t.snapshot(updatedProject, {
    id: "projects-updateProject(projectName: string, project: APIProjectType)",
  });

  const revertedProject = await api.updateProject(projectName, projectWithOwnerId);
  t.snapshot(revertedProject, {
    id: "projects-revertedProject",
  });
});

test.serial("pauseProject and resumeProject", async t => {
  const projectName = (await api.getProjects())[0].name;

  const pausedProject = await api.pauseProject(projectName);
  t.snapshot(pausedProject, { id: "projects-pauseProject(projectName: string)" });

  const resumedProject = await api.resumeProject(projectName);
  t.snapshot(resumedProject, { id: "projects-resumeProject(projectName: string)" });
});
