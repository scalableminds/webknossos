import UserPage from "./pages/user_page";
import Request from "./helpers/ajaxDownload";

describe("User List", () => {
  let page;

  // These async functions are executed synchronous when called via browser, otherwise
  // the whole test would need to be marked async and would be executed asynchronous
  browser.addCommand("getUsersFromServer", async () =>
    Request.json().from("/api/users?isEditable=true"),
  );

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

    const numUserListEntries = Math.min(userListEntries.length, maxUsersPerPage);

    const users = browser.getUsersFromServer();
    expect(users.length).toEqual(numUserListEntries);
  });

  it("should assign a new team", () => {
    // create a new team for assignment
    const newTeam = { team: "test2", role: { name: "user" } };

    const payload = {
      name: newTeam.team,
      parent: "Connectomics department",
      owner: "",
      roles: [{ name: "admin" }, { name: "user" }],
      isEditable: "true",
    };
    browser.createTeamOnServer(payload);
    // It is not possible to create a team from the users page, therefore refresh the page, so everything is up to date
    browser.pause(2000);
    browser.refresh();
    browser.pause(2000);

    // select first user 'SCM Boy' and switch the role of the newly created
    // team to 'user'
    page.selectSingleUser();
    page.selectSecondTeamRole();
    page.clickConfirmButton();

    // confirm that the user updated
    const users = browser.getUsersFromServer();
    expect(users[0].teams).toContain(newTeam);
  });

  it("should unselect a team of a user", () => {
    const newTeam = { team: "test2", role: "user" };
    page.selectSingleUser();
    page.unSelectSecondTeam();
    page.clickConfirmButton();

    // confirm that the user updated
    const users = browser.getUsersFromServer();
    expect(users[0].teams).not.toContain(newTeam);
  });

  it("should assign new experience", () => {
    const newExperience = { domain: "Testing", level: 42 };
    page.setExperience(newExperience);

    // confirm that the user updated
    const users = browser.getUsersFromServer();
    expect(users[0].experiences.Testing).toBe(42);
  });

  it("should increase an experience", () => {
    const newExperience = { domain: "Testing", level: 23 };
    page.increaseExperience(newExperience);

    const users = browser.getUsersFromServer();
    expect(users[0].experiences.Testing).toBe(65);
  });

  it("should delete an experience", () => {
    const newExperience = { domain: "Testing", level: 23 };
    page.deleteExperience(newExperience);

    const users = browser.getUsersFromServer();
    expect(users[0].experiences.Testing).toBeUndefined();
  });
});
