import TeamPage from "./pages/team_page";
import { getPaginationPagesCount, isWarningToastVisible } from "./helpers/pageHelpers";

describe("Team List", () => {
  let page;
  const maxTeamsPerPage = 10;

  // This async function is executed synchronous when called via browser, otherwise
  // the whole test would need to be marked async and would be executed asynchronous
  browser.addCommand("getTeamCountFromServer", async () => page.getTeamCountFromServer());

  beforeEach(() => {
    page = new TeamPage();
    page.get();
  });

  it("should show all teams", () => {
    const teamListEntries = page.getTeamListEntryCount();
    const numPaginationPages = getPaginationPagesCount();

    const numTeamListEntries = Math.min(teamListEntries, maxTeamsPerPage);

    const numTeams = browser.getTeamCountFromServer();
    expect(numTeams).toEqual(numTeamListEntries);
    expect(numPaginationPages).toEqual(Math.ceil(numTeams / maxTeamsPerPage));
  });

  it("should create a new team", () => {
    const oldTeamCount = browser.getTeamCountFromServer();
    const oldRowCount = page.getTeamListEntryCount();

    const newTeamName = "TestTeam";
    page.createTeam(newTeamName);

    const newRowCount = page.getTeamListEntryCount();
    const newTeamCount = browser.getTeamCountFromServer();

    expect(newTeamCount).toEqual(oldTeamCount + 1);

    if (oldRowCount <= maxTeamsPerPage - 1) {
      expect(newRowCount).toEqual(oldRowCount + 1);
    } // else the team was created on a new page
  });

  it("should create a new team with invalid name", () => {
    const oldTeamCount = browser.getTeamCountFromServer();

    // Team names must be at least 3 chars long
    const newTeamName = "Te";
    page.createTeam(newTeamName);
    const isWarningVisible = isWarningToastVisible();

    const newTeamCount = browser.getTeamCountFromServer();
    expect(newTeamCount).toEqual(oldTeamCount);
    expect(isWarningVisible).toBe(true);
  });

  it("should delete an existing team", () => {
    const oldTeamCount = browser.getTeamCountFromServer();
    const oldRowCount = page.getTeamListEntryCount();

    const teamName = "TestTeam";
    page.deleteTeam(teamName);

    const newRowCount = page.getTeamListEntryCount();
    const newTeamCount = browser.getTeamCountFromServer();

    expect(newTeamCount).toEqual(oldTeamCount - 1);
    expect(newRowCount).toEqual(oldRowCount - 1);
  });
});
