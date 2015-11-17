fs = require("fs")


readFile = (path, options = {}) ->

  return new Promise( (resolve, reject) ->
    fs.readFile(path, options, (error, data) ->
      if error
        reject(error)
      else
        resolve(data)
    )
  )


module.exports = readFile
