fs = require 'fs'


waitForFile = (path) ->
  return browser.driver.wait(
    -> return fs.existsSync path,
    30000
  )

module.exports = waitForFile
