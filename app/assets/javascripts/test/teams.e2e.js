import TeamPage from "./pages/team_page";
import { getPaginationPagesCount, isWarningToastVisible } from "./helpers/pageHelpers";

describe("Team List", () => {
  let page;
  const maxTeamsPerPage = 10;

  beforeEach(() => {
    page = new TeamPage();
    page.get();
  });

  it("should show all teams", async () => {
    const teamListEntries = await page.getTeamListEntryCount();
    const numPaginationPages = await getPaginationPagesCount();

    const numTeamListEntries = Math.min(teamListEntries, maxTeamsPerPage);

    const numTeams = await await page.getTeamCountFromServer();
    expect(numTeams).toEqual(numTeamListEntries);
    expect(numPaginationPages).toEqual(Math.ceil(numTeams / maxTeamsPerPage));
  });


  it("should create a new team", async () => {
    const oldTeamCount = await page.getTeamCountFromServer();
    const oldRowCount = await page.getTeamListEntryCount();

    const newTeamName = "TestTeam";
    await page.createTeam(newTeamName);

    const newRowCount = await page.getTeamListEntryCount();
    const newTeamCount = await page.getTeamCountFromServer();

    expect(newTeamCount).toEqual(oldTeamCount + 1);

    if (oldRowCount <= maxTeamsPerPage - 1) {
      expect(newRowCount).toEqual(oldRowCount + 1);
    } // else the team was created on a new page
  });


  it("should create a new team with invalid name", async () => {
    const oldTeamCount = await page.getTeamCountFromServer();

    // Team names must be at least 3 chars long
    const newTeamName = "Te";
    await page.createTeam(newTeamName);
    const isWarningVisible = await isWarningToastVisible();

    const newTeamCount = await page.getTeamCountFromServer();
    expect(newTeamCount).toEqual(oldTeamCount);
    expect(isWarningVisible).toBe(true);
  });


  it("should delete an existing team", async () => {
    const oldTeamCount = await page.getTeamCountFromServer();
    const oldRowCount = await page.getTeamListEntryCount();

    const teamName = "TestTeam";
    await page.deleteTeam(teamName);

    const newRowCount = await page.getTeamListEntryCount();
    const newTeamCount = await page.getTeamCountFromServer();

    expect(newTeamCount).toEqual(oldTeamCount - 1);
    expect(newRowCount).toEqual(oldRowCount - 1);
  });
});

