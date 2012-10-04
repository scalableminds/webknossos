### define ###

request = (options) ->

  deferred = $.Deferred()

  _.defaults(options,
    method: 'GET',
    responseType: null,
    data: null
    contentType: null
  )

  return deferred.reject('No url defined').promise() unless options.url

  if options.data
    options.data = JSON.stringify(options.data) if options.contentType == 'application/json'
    options.data = jQuery.param(options.data)   if options.contentType == 'application/x-www-form-urlencoded'
    options.method = 'POST' if options.method == 'GET'

  xhr = new XMLHttpRequest()
  xhr.open options.method, options.url, true
  if options.responseType && options.responseType != "json"
    xhr.responseType = options.responseType 
  xhr.setRequestHeader('Content-Type', options.contentType) if options.contentType

  xhr.onload = ->
    if @status == 200
      if options.responseType == "json"
        try
          data = JSON.parse @response
        catch error
          return deferred.reject(error)
        deferred.resolve(data)
      else
        deferred.resolve(@response)
    else
      deferred.reject(@statusText)
  
  xhr.onerror = (err) ->
    deferred.reject(err)

  xhr.send(options.data)

  deferred.promise()