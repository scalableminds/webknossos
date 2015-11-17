rimraf = require("rimraf")


rmdir = (path) ->

  return new Promise( (resolve) ->
    rimraf(path, resolve)
  )


module.exports = rmdir
