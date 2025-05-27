import _ from "lodash";
import {
  tokenUserA,
  tokenUserB,
  tokenUserC,
  tokenUserD,
  tokenUserE,
  setUserAuthToken,
  resetDatabase,
} from "test/e2e-setup";
import { getTask } from "admin/api/tasks";
import * as api from "admin/rest_api";
import { describe, test, beforeAll, expect } from "vitest";

function getExpectedErrorObject(errorMessage: string) {
  return { errors: [JSON.stringify({ messages: [{ error: errorMessage }] })] };
}

describe("Team Structure Tests (E2E)", () => {
  /*
TEAM STRUCTURE USED FOR TESTING:

Organizations:
Organization X, Organization Y

Teams:
team_X1, team_X2, team_X3, team_X4, team_Y1

User:
user_A, user_B, user_C, user_D, user_E

++----------------------------------------------------------------------------------------------------------------------++--------------------------------------++
||  Organization X                                                                                                      ||  Organization Y                      ||
||  Admin: user_A                                                                                                       ||  Admin: user_E                       ||
++----------------------------------+---------------------------+---------------------------+---------------------------++--------------------------------------++
|| team_X1                          |  team_X2                  |  team_X3                  |  team_X4                  ||  team_Y1                             ||
++----------------------------------+---------------------------+---------------------------+---------------------------++--------------------------------------++
|| user_A (teamMng)                 |  user_D (teamMng.)        |  user_A                   |  user_A (teamMng.)        ||  user_E	(teamMng.)                  ||
|| user_B (teamMng.)                |                           |                           |                           ||                                      ||
|| user_C                           |                           |                           |                           ||                                      ||
++----------------------------------+---------------------------+---------------------------+---------------------------++--------------------------------------++
 */

  beforeAll(async () => {
    // Reset database
    resetDatabase();
  });

  // Teams
  test("teams_userDefault", async () => {
    setUserAuthToken(tokenUserA);

    const teams = _.sortBy(await api.getTeams(), (team) => team.name);

    expect(teams[0].name).toBe("team_X1");
    expect(teams[1].name).toBe("team_X2");
    expect(teams[2].name).toBe("team_X3");
    expect(teams[3].name).toBe("team_X4");
    expect(teams.length).toBe(4);
  });

  test("teams_user_D", async () => {
    setUserAuthToken(tokenUserD);

    const teams = _.sortBy(await api.getTeams(), (team) => team.name);

    expect(teams[0].name).toBe("team_X2");
    expect(teams.length).toBe(1);
  });

  test("teams_user_E", async () => {
    setUserAuthToken(tokenUserE);

    const teams = _.sortBy(await api.getTeams(), (team) => team.name);

    expect(teams[0].name).toBe("team_Y1");
    expect(teams.length).toBe(1);
  });

  test("teams_delete_user_D", async () => {
    // the teamManager is not allowed to delete the team
    setUserAuthToken(tokenUserD);

    await expect(api.deleteTeam("69882b370d889b84020efd4f")).rejects.toMatchObject(
      getExpectedErrorObject("Access denied. Only admin users can execute this operation."),
    );
  });

  test("teams_create_user_D", async () => {
    // the teamManager is not allowed to create a new team
    setUserAuthToken(tokenUserD);

    const newTeam = {
      name: "test-team-name",
    };
    await expect(api.createTeam(newTeam)).rejects.toMatchObject(
      getExpectedErrorObject("Access denied. Only admin users can execute this operation."),
    );
  });

  // TaskTypes
  test("taskTypes_userDefault", async () => {
    setUserAuthToken(tokenUserA);

    const taskTypes = _.sortBy(await api.getTaskTypes(), (taskType) => taskType.id);

    expect(taskTypes[0].description).toBe("Check those cells out!");
    expect(taskTypes.length).toBe(2);
  });

  test("taskTypes_user_D", async () => {
    setUserAuthToken(tokenUserD);

    const taskTypes = _.sortBy(await api.getTaskTypes(), (taskType) => taskType.id);

    expect(taskTypes.length).toBe(1);
  });

  test("taskTypes_user_E", async () => {
    setUserAuthToken(tokenUserE);

    const taskTypes = _.sortBy(await api.getTaskTypes(), (taskType) => taskType.id);

    expect(taskTypes.length).toBe(0);
  });

  // Tasks
  test("tasks_user_D", async () => {
    setUserAuthToken(tokenUserD);

    await expect(getTask("58135c192faeb34c0081c058")).rejects.toMatchObject(
      getExpectedErrorObject("Task could not be found"),
    );
  });

  test("tasks_user_E", async () => {
    setUserAuthToken(tokenUserE);

    await expect(getTask("58135c192faeb34c0081c058")).rejects.toMatchObject(
      getExpectedErrorObject("Task could not be found"),
    );
  });

  test("tasks_user_C", async () => {
    setUserAuthToken(tokenUserC);
    const task = await getTask("58135c192faeb34c0081c058");
    expect(task.id).toBe("58135c192faeb34c0081c058");
  });

  // User
  test("user_user_B", async () => {
    // teamMng are not allowed to de-/activate a user (if they are not an admin)
    setUserAuthToken(tokenUserB);

    const userIdC = "770b9f4d2a7c0e4d008da6ef";
    const user = await api.getUser(userIdC);
    expect(user.firstName).toBe("user_C");

    const newUser = Object.assign({}, user, {
      isActive: false,
    });

    await expect(api.updateUser(newUser)).rejects.toMatchObject(
      getExpectedErrorObject("You are not authorized to view or edit this resource"),
    );
  });

  // Project
  test("project_user_B", async () => {
    // teamMng are not allowed to delete a project (if they are not an admin and they are not the owner)
    setUserAuthToken(tokenUserE);

    const projectId = "58135bfd2faeb3190181c057";
    await expect(api.deleteProject(projectId)).rejects.toMatchObject(
      getExpectedErrorObject("Project could not be found"),
    );
  });
});
