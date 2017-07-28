import _ from "lodash";
import UserPage from "./pages/user_page";
import Request from "./helpers/ajaxDownload";
import { getPaginationPagesCount } from "./helpers/pageHelpers";

describe("User List", () => {
  let page;

  // These async functions are executed synchronous when called via browser, otherwise
  // the whole test would need to be marked async and would be executed asynchronous
  browser.addCommand("getUsersFromServer", async url => Request.json().from(url));

  browser.addCommand("createTeamOnServer", async payload =>
    Request.json().upload("/api/teams", { data: payload }),
  );

  beforeEach(() => {
    page = new UserPage();
    page.get();
  });

  it("should show all users", () => {
    const maxUsersPerPage = 50;
    const userListEntries = page.getUserListEntries();
    const numPaginationPages = getPaginationPagesCount();

    const numUserListEntries = Math.min(userListEntries.length, maxUsersPerPage);

    const url = "/api/users?isEditable=true";
    const users = browser.getUsersFromServer(url);
    expect(users.length).toEqual(numUserListEntries);
    expect(numPaginationPages).toEqual(Math.ceil(users.length / maxUsersPerPage));
  });

  it("should assign a new team", () => {
    // create a new team for assignment
    const newTeamName = "test2";
    const payload = {
      name: newTeamName,
      parent: "Connectomics department",
      owner: "",
      roles: [{ name: "admin" }, { name: "user" }],
      isEditable: "true",
    };
    browser.createTeamOnServer(payload);
    // It is not possible to create a team from the users page, therefore refresh the page, so everything is up to date
    browser.refresh();

    // select first user 'SCM Boy' and switch the role of the newly created
    // team to 'user'
    page.selectUser("SCM Boy");
    page.selectTeams([newTeamName]);
    page.clickConfirmButton();
    // confirm that the user table updated
    const teamsAndRoles = page.getTeamsAndRolesForUser("SCM Boy");
    expect(_.keys(teamsAndRoles)).toContain(newTeamName);
    expect(teamsAndRoles[newTeamName]).toBe("user");
  });

  it("should change roles of two teams", () =>
    // TODO
    false);

  it("should assign new experience", () => {
    const newExperience = { domain: "Testing", level: 42 };
    page.setExperience("SCM Boy", newExperience);

    const experiences = page.getExperiencesForUser("SCM Boy");
    expect(experiences).toContain(newExperience);
  });

  it("should increase an experience", () => {
    const newExperience = { domain: "Testing", level: 23 };
    page.increaseExperience("SCM Boy", newExperience);

    const experiences = page.getExperiencesForUser("SCM Boy");
    expect(experiences).toContain(newExperience);
  });

  it("should delete an experience", () => {
    const newExperience = { domain: "Testing", level: 23 };
    page.deleteExperience("SCM Boy", newExperience);

    const experiences = page.getExperiencesForUser("SCM Boy");
    expect(experiences).not.toContain(newExperience);
  });
});
