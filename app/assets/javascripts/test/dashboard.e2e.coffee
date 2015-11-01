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
    it 'should download an NML file', (done) ->
      testFile = path.join(
        __dirname,
        'testFiles',
        DashboardPage.SAMPLE_NML_PATH
      )

      # remove tmp dir
      rmdir browser.params.DOWNLOAD_DIRECTORY
        # download file
        .then -> return page.downloadSampleNML()

        # read files for comparison
        .then -> return readFile page.getSampleNMLPath()
        .then (fileContentDownload) ->
          return readFile testFile
            .then (fileContentCheck) ->
              return { fileContentDownload, fileContentCheck }

        # compare files
        .then ({ fileContentCheck, fileContentDownload }) ->
          expect(fileContentDownload).toBeTruthy()
          expect(fileContentCheck).toBeTruthy()

          # this expect will crash the app if file contents do not exist
          if (fileContentCheck && fileContentDownload)
            expect(fileContentDownload.equals(fileContentCheck)).toBeTruthy()

          done()
        .catch (error) -> throw error
