import ProjectPage from "./pages/project_page"
import { getPaginationPagesCount } from "./helpers/pageHelpers"
import Request from "./helpers/ajaxDownload"

describe("Project List", function() {

  var page
  const maxProjectsPerPage = 10

  beforeEach(function() {
    page = new ProjectPage()
    page.get()
  })

  it("should show all projects", async function() {

    const numProjectListRows = await page.getProjectListEntryCount()
    const numPaginationPages = await getPaginationPagesCount()

    const numProjectListEntries = Math.min(numProjectListRows, maxProjectsPerPage)
    const numProjects = await page.getProjectCountFromServer()

    expect(numProjects).toEqual(numProjectListEntries)
    expect(numPaginationPages).toEqual(Math.ceil(numProjects / maxProjectsPerPage))
  })


  it("should create a new project", async function() {

    const oldProjectCount = await page.getProjectCountFromServer()
    const oldRowCount = await page.getProjectListEntryCount()

    const newProject = {
      name : "TestProject",
      priority : 100
    }
    await page.createProject(newProject)

    const newRowCount = await page.getProjectListEntryCount()
    const newProjectCount = await page.getProjectCountFromServer()

    expect(newProjectCount).toEqual(oldProjectCount + 1)

    if (oldRowCount <= maxProjectsPerPage - 1) {
      expect(newRowCount).toEqual(oldRowCount + 1)
    } // else the project was created on a new page
  })


  it("should download a project", async function() {

    const url = await page.getFirstDownloadURl()

    // Should successfully download a blob
    return Request.text().from(url)
  })


  it("should edit a project's experience", async function() {

    const newPriority = 42
    await page.editFirstProject(newPriority)

    const allPriorities = await page.getAllPriorities()
    expect(allPriorities).toContain(newPriority)
  })


  it("should delete a project", async function() {

    const oldProjectCount = await page.getProjectCountFromServer()
    const oldRowCount = await page.getProjectListEntryCount()

    await page.deleteFirstProject()

    const newRowCount = await page.getProjectListEntryCount()
    const newProjectCount = await page.getProjectCountFromServer()

    expect(newProjectCount).toEqual(oldProjectCount - 1)
  })


})


