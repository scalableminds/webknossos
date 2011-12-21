request = (options, callback) ->

  _.defaults(options,
    method: 'GET',
    responseType: null,
    data: null
    contentType: 'application/x-www-form-urlencoded'
  )

  throw new Error 'No url defined' unless options.url

  if options.data
    options.data = JSON.stringify(options.data) if options.contentType == 'application/json'
    options.data = jQuery.param(options.data)   if options.contentType == 'application/x-www-form-urlencoded'

  xhr = new XMLHttpRequest()
  xhr.open options.method, options.url, true
  xhr.responseType = options.responseType if options.responseType
  xhr.setRequestHeader 'Content-Type', options.contentType

  xhr.onload = ->
    if @status == 200
      callback null, @response
    else
      callback @statusText
  
  xhr.onerror = (err) ->
    callback err
  

  xhr.send(options.data)