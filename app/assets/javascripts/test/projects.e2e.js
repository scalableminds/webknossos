import ProjectPage from "./pages/project_page";
import { getPaginationPagesCount } from "./helpers/pageHelpers";
import Request from "./helpers/ajaxDownload";

describe("Project List", () => {
  let page;
  const maxProjectsPerPage = 10;

  // This async function is executed synchronous when called via browser, otherwise
  // the whole test would need to be marked async and would be executed asynchronous
  browser.addCommand("getProjectCountFromServer", async () => page.getProjectCountFromServer());

  beforeEach(() => {
    page = new ProjectPage();
    page.get();
  });

  it("should show all projects", () => {
    const numProjectListRows = page.getProjectListEntryCount();
    const numPaginationPages = getPaginationPagesCount();

    const numProjectListEntries = Math.min(numProjectListRows, maxProjectsPerPage);
    const numProjects = browser.getProjectCountFromServer();

    expect(numProjects).toEqual(numProjectListEntries);
    expect(numPaginationPages).toEqual(Math.ceil(numProjects / maxProjectsPerPage));
  });

  it("should create a new project", () => {
    const oldProjectCount = browser.getProjectCountFromServer();
    const oldRowCount = page.getProjectListEntryCount();

    const newProject = {
      name: "TestProject",
      priority: 100,
    };
    page.createProject(newProject);

    const newRowCount = page.getProjectListEntryCount();
    const newProjectCount = browser.getProjectCountFromServer();

    expect(newProjectCount).toEqual(oldProjectCount + 1);

    if (oldRowCount <= maxProjectsPerPage - 1) {
      expect(newRowCount).toEqual(oldRowCount + 1);
    } // else the project was created on a new page
  });

  it("should download a project", () => {
    const url = page.getFirstDownloadURl();

    // Should successfully download a blob
    return Request.text().from(url);
  });

  it("should edit a project's experience", () => {
    const newPriority = 42;
    page.editFirstProject(newPriority);

    const allPriorities = page.getAllPriorities();
    expect(allPriorities).toContain(newPriority);
  });

  it("should delete a project", () => {
    const oldProjectCount = browser.getProjectCountFromServer();

    page.deleteFirstProject();

    const newProjectCount = browser.getProjectCountFromServer();

    expect(newProjectCount).toEqual(oldProjectCount - 1);
  });
});
