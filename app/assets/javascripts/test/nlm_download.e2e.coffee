path = require 'path'
rmdir = require './helpers/rimraf-promised'
readFile = require './helpers/readFile-promised'
DashboardPage = require './pages/DashboardPage'


describe 'NML Download', ->

  it 'should download an NML file', (done) ->
    testFile = path.join(
      __dirname,
      'testFiles',
      DashboardPage.SAMPLE_NML_PATH
    )

    page = new DashboardPage()
    page.get()

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

        # this check will crash the app if file contents do not exist
        if (fileContentCheck && fileContentDownload)
          expect(fileContentDownload.equals(fileContentCheck)).toBeTruthy()

        done()
      .catch (error) -> throw error
