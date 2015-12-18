### define
jquery : $
underscore : _
libs/toast : Toast
###

Request =

  # IN:  nothing
  # OUT: json
  receiveJSON : (url, options = {}) ->

    return @triggerRequest(
      url,
      _.defaultsDeep(options, {headers : {"Accept": "application/json" }})
      @handleEmptyJsonResponse
    )


  # IN:  json
  # OUT: json
  sendJSONReceiveJSON : (url, options = {}) ->

    body = if typeof(options.data) == "string"
        options.data
      else
        JSON.stringify(options.data)

    return @receiveJSON(
      url,
      _.defaultsDeep(options,
        method : "POST"
        body : body
        headers :
          "Content-Type" : "application/json"
      )
    )


  # IN:  multipart formdata
  # OUT: json
  sendMultipartFormReceiveJSON : (url, options = {}) ->

    body = if options. instanceof FormData
        options.data
      else
        formData = new FormData()
        for key of options.data
          formData.append(key, options.data[key])
        formData

    return @receiveJSON(
      url,
      _.defaultsDeep(options,
        method : "POST"
        body : formData
      )
    )


  # IN:  url-encoded formdata
  # OUT: json
  sendUrlEncodedFormReceiveJSON : (url, options = {}) ->

    body = if typeof(options.data) == "string"
        options.data
      else
        options.data.serialize()

    return @receiveJSON(
      url,
      _.defaultsDeep(options,
        method : "POST"
        body : body
        headers :
          "Content-Type" : "application/x-www-form-urlencoded"
      )
    )


  receiveArraybuffer : (url, options = {}) ->

    return @triggerRequest(
      url,
      _.defaultsDeep(options, { headers : { "Accept": "application/octet-stream" }})
      (response) ->
        response.arrayBuffer()
    )


  # IN:  arraybuffer
  # OUT: arraybuffer
  sendArraybufferReceiveArraybuffer : (url, options = {}) ->

    body = if options.data instanceof ArrayBuffer
        options.data
      else
        options.data.buffer.slice(0, options.data.byteLength)

    return @receiveArraybuffer(
      url,
      _.defaultsDeep(options,
        method : "POST"
        body : body
        headers :
          "Content-Type" : "application/octet-stream"
      )
    )


  triggerRequest : (url, options, responseDataHandler) ->

    defaultOptions =
      method : "GET"
      credentials : "same-origin"
      headers : {}
      doNotCatch : false

    options = _.defaultsDeep(options, defaultOptions)

    headers = new Headers()
    for name of options.headers
      headers.set(name, options.headers[name])
    options.headers = headers

    fetchPromise = fetch(url, options)
      .then(@handleStatus)
      .then(responseDataHandler)

    if not options.doNotCatch
      fetchPromise = fetchPromise.catch(@handleError)

    if options.timeout?
      return Promise.race([ fetchPromise, @timeoutPromise(options.timeout) ])
    else
      return fetchPromise


  timeoutPromise : (timeout) ->
    return new Promise( (resolve, reject) ->
      setTimeout(
        -> reject("timeout")
        timeout
      )
    )

  handleStatus : (response) ->

    if 200 <= response.status < 400
      return Promise.resolve(response)

    return Promise.reject(response)


  handleError : (error) ->

    if error instanceof Response
      error.json().then(
        (json) ->
          Toast.message(json.messages)
          Promise.reject(json)
        (error) ->
          Toast.error(error)
          Promise.reject(error)
      )
    else
      Toast.error(error)
      Promise.reject(error)


  handleEmptyJsonResponse : (response) ->

    contentLength = parseInt(response.headers.get("Content-Length"))
    if contentLength == 0
      Promise.resolve({})
    else
      response.json()


  # Extends the native Promise API with `always` functionality similar to jQuery.
  # http://api.jquery.com/deferred.always/
  always : (promise, func) ->

    promise.then(func, func)


  # Wraps a native Promise as a jQuery deferred.
  # http://api.jquery.com/category/deferred-object/
  $ : (promise) ->

    deferred = new $.Deferred()

    promise.then(
      (success) ->
        deferred.resolve(success)
      (error) ->
        deferred.reject(error)
    )

    deferred.promise()
