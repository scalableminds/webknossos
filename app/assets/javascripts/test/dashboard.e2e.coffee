path = require 'path'
rmdir = require './helpers/rimraf-promised'
readFile = require './helpers/readFile-promised'
waitForSelector = require './helpers/waitForSelector'
DashboardPage = require './pages/DashboardPage'


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

    testFile = path.join(
      __dirname,
      'testFiles',
      DashboardPage.SAMPLE_NML_PATH
    )

    it 'should download an NML file', (done) ->

      # remove tmp dir
      rmdir browser.params.DOWNLOAD_DIRECTORY

        # download file
        .then( -> return page.downloadSampleNML() )

        # when we got here, waitForFile succeeded
        # which means file was actually downloaded
        .then( -> done() )


    it 'should contain correct NML data', (done) ->

      # download file via ajax request
      page.downloadSampleNMLViaAjax()

        # read check file
        .then( (nmlContent) ->
          return readFile(testFile, 'utf8')
            .then( (fileContent) ->
              return { fileContent, nmlContent }
            )
        )

        # compare download and test file
        .then( ({ fileContent, nmlContent }) ->
          expect(nmlContent).toEqual(fileContent)
          done()
        )

        # error handling
        .catch( (error) -> throw error )
