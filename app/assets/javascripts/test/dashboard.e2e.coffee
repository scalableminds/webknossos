DashboardPage = require "./pages/DashboardPage"
Download = require("./helpers/ajaxDownload")


describe "Dashboard", ->

  page = null
  beforeEach ->
    page = new DashboardPage()
    page.get()


  describe "Tasks", ->

    it "should open tasks", ->

      page.openTasksTab()
      title = browser.element(".tab-content h3").getText()
      expect(title).toBe("Tasks")


    it "should have no available tasks", ->

      page.openTasksTab()
      tasks = page.getTasks()
      expect(tasks.length).toBe(0)


    it "should get a new task", ->

      page.getNewTask()
      tasks = page.getTasks()
      # TODO
      # expect(tasks.length).toBe(1)


  describe "NML Download", ->

    it "should download an NML file", (done) ->

      page.openExplorativeTab()
      url = page.getFirstDownloadLink()
      Download.text().from(url)
      .then((nmlContent) ->
        expect(nmlContent.length).toBeGreaterThan(0)
        expect(nmlContent.startsWith("<things>")).toBe(true)
        expect(nmlContent.endsWith("</things>")).toBe(true)
        done()
      )

