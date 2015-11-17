fetch = require("fetch")


###
# Download Helper Module
# Collection of static methods for downloading and content convertion.
###
Download =

  ###
  # Build fetch-from method and inject given converter
  ###
  fetchFactory : (converter) ->

    errorHandler = (response) ->

      if (response.status >= 200 && response.status < 300)
        return response

      error = new Error(response.statusText)
      error.response = response
      return error


    return {
      from: (url) ->

        fetch(url)
          .then(errorHandler)
          .then(converter)
    }


  ### CONVERTERS ###

  text : ->

    return @fetchFactory( (response) -> response.text() )


  json : ->

    return @fetchFactory( (response) -> response.json() )


module.exports = Download
