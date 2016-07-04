DashboardPage = require "./pages/dashboard_page"
Download = require("./helpers/ajaxDownload")

describe "Dashboard", ->

  page = null
  beforeEach ->
    page = new DashboardPage()
    page.get()

  getTabTitle = ->
    return browser.element(".tab-content h3").getText()

  describe "NML Download", ->

    it "should download an NML file", (done) ->

      page.openExplorativeTab()
      url = page.getFirstDownloadLink()
      Download.text().from(url).then((nmlContent) ->
        expect(nmlContent.length).toBeGreaterThan(0)
        expect(nmlContent.startsWith("<things>")).toBe(true)
        expect(nmlContent.endsWith("</things>")).toBe(true)
        done()
      )

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

      expect(getTabTitle()).toBe("Tasks")
      expect(browser.isExisting(page.newTaskButton)).toEqual(false)
      expect(browser.isExisting(page.downloadButton)).toEqual(true)

    it "should display user's tracked time", (done) ->

      page.openTrackedTimeTab()
      expect(getTabTitle()).toBe("Tracked Time")

      timeTableEntries = page.getTimeTableEntries()
      timeGraphEntries = page.getTimeGraphEntries()

      url = "http://localhost:9000/api/users/570b9f4d2a7c0e4d008da6ef/loggedTime"
      Download.json().from(url).then((response) ->

        numTimeEntries = response.loggedTime.length

        expect(timeTableEntries.length).toEqual(numTimeEntries)
        expect(timeGraphEntries.length).toEqual(numTimeEntries)
        done()
      )

    it "should display user's explorative annotations", ->

      page.openExplorativeTab()
      expect(getTabTitle()).toBe("Explorative Annotations")


