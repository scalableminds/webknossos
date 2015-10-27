fs = require 'fs'


readFile = (path) ->
  return new Promise (resolve, reject) ->
    fs.readFile path, (error, data) ->
      if error
        reject error
      else
        resolve data


module.exports = readFile
