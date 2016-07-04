DashboardPage = require "./pages/DashboardPage"
Download = require("./helpers/ajaxDownload")

describe "Dashboard", ->

  page = null
  beforeEach ->
    page = new DashboardPage()
    page.get()

  getTabTitle = ->
    return browser.element(".tab-content h3").getText()

  describe "Tasks", ->

    it "should open tasks", ->

      page.openTasksTab()
      expect(getTabTitle()).toBe("Tasks")


    it "should have no available tasks", ->

      page.openTasksTab()
      tasks = page.getTasks()
      expect(tasks.length).toBe(0)


    it "should get a new task", ->

      page.getNewTask()
      tasks = page.getTasks()
      # TODO
      # expect(tasks.length).toBe(1)


  describe "as another user", ->

    beforeEach ->
      page.openDashboardAsUser()

    it "should display user's tasks", ->

      page.openTasksTab()
      expect(getTabTitle()).toBe("Tasks")
      expect(browser.isExisting(page.newTaskButton)).toEqual(false)
      expect(browser.isExisting(page.downloadButton)).toEqual(true)

    it "should display user's explorative annotations", ->

      page.openExplorativeTab()
      expect(getTabTitle()).toBe("Explorative Annotations")

    it "should display user's tracked time", ->

      page.openTrackedTimeTab()
      expect(getTabTitle()).toBe("Tracked Time")




  describe "NML Download", ->

    it "should download an NML file", (done) ->

      page.openExplorativeTab()
      url = page.getFirstDownloadLink()
      console.log("i did it")
      Download.text().from(url).then((nmlContent) ->
        console.log("i did it 2")
        console.log(nmlContent)
        expect(nmlContent.length).toBeGreaterThan(0)
        expect(nmlContent.startsWith("<things>")).toBe(true)
        expect(nmlContent.endsWith("</things>")).toBe(true)
        done()
      )

