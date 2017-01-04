import _ from "lodash";
import UserPage from "./pages/user_page";
import Request from "./helpers/ajaxDownload";
import { getPaginationPagesCount } from "./helpers/pageHelpers";

describe("User List", () => {
  let page;

  beforeEach(() => {
    page = new UserPage();
    page.get();
  });

  it("should show all users", async () => {
    const maxUsersPerPage = 50;
    const userListEntries = await page.getUserListEntries();
    const numPaginationPages = await getPaginationPagesCount();

    const numUserListEntries = Math.min(userListEntries.length, maxUsersPerPage);

    const url = "/api/users?isEditable=true";
    const users = await Request.json().from(url);
    expect(users.length).toEqual(numUserListEntries);
    expect(numPaginationPages).toEqual(Math.ceil(users.length / maxUsersPerPage));
  });


  it("should assign a new team", () => {
    // create a new team for assignment
    const newTeamName = "test2";
    const payload = { name: newTeamName, parent: "Connectomics department", owner: "", roles: [{ name: "admin" }, { name: "user" }], isEditable: "true" };

    return Request.json().upload("/api/teams", { data: payload }).then(
      async (response) => {
        // select first user 'SCM Boy' and switch the role of the newly created
        // team to 'user'
        await page.selectUser("SCM Boy");
        await page.selectTeams([newTeamName]);
        await page.clickConfirmButton();

        // confirm that the user table updated
        const teamsAndRoles = await page.getTeamsAndRolesForUser("SCM Boy");
        expect(_.keys(teamsAndRoles)).toContain(newTeamName);
        expect(teamsAndRoles[newTeamName]).toBe("user");
      });
  });


  it("should change roles of two teams", () =>
    // TODO
     false);


  it("should assign new experience", async () => {
    const newExperience = { domain: "Testing", level: 42 };
    await page.setExperience("SCM Boy", newExperience);

    const experiences = await page.getExperiencesForUser("SCM Boy");
    expect(experiences).toContain(newExperience);
  });


  it("should increase an experience", async () => {
    const newExperience = { domain: "Testing", level: 23 };
    await page.increaseExperience("SCM Boy", newExperience);

    const experiences = await page.getExperiencesForUser("SCM Boy");
    expect(experiences).toContain(newExperience);
  });


  it("should delete an experience", async () => {
    const newExperience = { domain: "Testing", level: 23 };
    await page.deleteExperience("SCM Boy", newExperience);

    const experiences = await page.getExperiencesForUser("SCM Boy");
    expect(experiences).not.toContain(newExperience);
  });
});

