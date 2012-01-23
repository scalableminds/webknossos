request = (options, callback) ->

  # deferred = $.Deferred()

  _.defaults(options,
    method: 'GET',
    responseType: null,
    data: null
    contentType: 'application/x-www-form-urlencoded'
  )

  # return deferred.reject('No url defined').promise() unless options.url

  if options.data
    options.data = JSON.stringify(options.data) if options.contentType == 'application/json'
    options.data = jQuery.param(options.data)   if options.contentType == 'application/x-www-form-urlencoded'

  xhr = new XMLHttpRequest()
  xhr.open options.method, options.url, true
  xhr.responseType = options.responseType if options.responseType
  xhr.setRequestHeader 'Content-Type', options.contentType

  xhr.onload = ->
    if @status == 200
      callback(null, @response) if callback
      # deferred.resolve(@response)
    else
      callback(@statusText) if callback
      # deferred.reject(@statusText)
  
  xhr.onerror = (err) ->
    callback(err) if callback
    # deferred.reject(@statusText)
  

  xhr.send(options.data)

  # deferred.promise()