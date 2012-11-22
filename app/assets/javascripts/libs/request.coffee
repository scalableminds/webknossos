### define ###

Request = 

  send : (options) ->

    if options.dataType == "blob" or options.dataType == "arraybuffer"
      
      deferred = $.Deferred()

      return deferred.reject("No url defined").promise() unless options.url

      _.defaults(options, type: "GET", data: null)

      options.type = "POST" if options.type == "GET" and options.data

      xhr = new XMLHttpRequest()
      xhr.open options.type, options.url, true
      xhr.responseType = options.dataType 
      xhr.setRequestHeader("Content-Type", options.contentType) if options.contentType

      xhr.onload = ->
        if @status == 200
          deferred.resolve(@response)
        else
          deferred.reject(@statusText)
      
      xhr.onerror = (err) ->
        deferred.reject(err)

      xhr.send(options.data)

      deferred.promise()
    
    else
      
      if options.data
        options.data = JSON.stringify(options.data)
        options.contentType = "application/json" unless options.contentType
      
      $.ajax(options)