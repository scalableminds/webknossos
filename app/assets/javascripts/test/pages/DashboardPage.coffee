path = require 'path'
waitForFile = require '../helpers/waitForFile'
EC = protractor.ExpectedConditions


class DashboardPage
  @SAMPLE_NML_PATH = 'testdata__explorational__sboy__8c52bf.nml'

  get: ->
    browser.get '/dashboard'

  ### DOM OBJECTS ###
  explorativeTab = element By.css '#tab-explorative'
  # coffeelint: disable=max_line_length
  downloadButton = element By.css '#explorative-tasks a[href="/annotations/Explorational/562b9336a6f09eba008c52bf/download"]'
  # coffeelint: enable=max_line_length

  ### ACTIONS ###
  openExplorativeTab: ->
    return @waitForTab()
      .then (tab) -> tab.click()

  clickDownloadButton: ->
    return @waitForButton()
      .then (btn) -> btn.click()

  downloadSampleNML: ->
    return @openExplorativeTab()
      .then => @clickDownloadButton()
      .then => waitForFile @getSampleNMLPath()

  ### HELPERS ###
  waitForTab: ->
    isPresent = EC.visibilityOf explorativeTab
    return browser.wait isPresent, 5000
      .then -> return explorativeTab

  waitForButton: ->
    isPresent = EC.visibilityOf downloadButton
    return browser.wait isPresent, 5000
      .then -> return downloadButton

  getSampleNMLPath: ->
    return path.join(
      browser.params.DOWNLOAD_DIRECTORY
      DashboardPage.SAMPLE_NML_PATH
    )


module.exports = DashboardPage
