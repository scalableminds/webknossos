waitForSelector = require './helpers/waitForSelector'
DashboardPage = require './pages/DashboardPage'
Download = require("./helpers/ajaxDownload")


describe 'Dashboard', ->

  page = null
  beforeEach ->
    page = new DashboardPage()
    page.get()


  describe 'Tasks', ->

    it 'should open tasks', (done) ->

      page.openTasksTab()
        .then -> waitForSelector '.tab-content h3'
        .then (title) ->
          expect(title.getText()).toBe('Tasks')
          done()


    it 'should have no available tasks', (done) ->

      page.openTasksTab()
        .then -> page.getTasks()
        .then (tasks) ->
          expect(tasks.length).toBe(0)
          done()


    it 'should get a new task', (done) ->

      page.getNewTask()
        .then -> page.getTasks()
        .then (tasks) ->
          # TODO: load a new task and assert a task to be present
          # exepect(tasks.length).toBe(1)
          done()


  describe 'NML Download', ->

    it 'should download an NML file', (done) ->

      # remove tmp dir
      page.openExplorativeTab()
        .then( -> page.getFirstDownloadLink())
        .then( (url) -> Download.text().from(url))
        .then( (nmlContent) ->
          expect(nmlContent.length).toBeGreaterThan(0)
          expect(nmlContent.startsWith("<things>")).toBe(true)
          expect(nmlContent.endsWith("</things>")).toBe(true)
        )
        .then( -> done())

