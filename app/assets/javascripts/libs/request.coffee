### define
jquery : $
underscore : _
libs/toast : Toast
###

Request =

  # IN:  nothing / json
  # OUT: json
  json : (url, options = {}) ->

    @triggerRequest(
      url
      options
      (data) ->
        method : "POST"
        body : if typeof(data) == "string" then data else JSON.stringify(data)
        headers :
          "Content-Type" : "application/json"
      (response) ->
        response.json()
    )


  # IN:  multipart formdata
  # OUT: json
  multipartForm : (url, options = {}) ->

    @triggerRequest(
      url
      options
      (data) ->
        if data instanceof FormData
          formData = data
        else
          formData = new FormData()
          for key of options.data
            formData.append(key, options.data[key])

        method : "POST"
        body : formData
      (response) ->
        response.json()
    )


  # IN:  url-encoded formdata
  # OUT: json
  urlEncodedForm : (url, options = {}) ->

    @triggerRequest(
      url
      options
      (data) ->
        method : "POST"
        body : if typeof(data) == "string" then data else data.serialize()
        headers :
          "Content-Type" : "application/x-www-form-urlencoded"
      (response) ->
        response.json()
    )


  # IN:  arraybuffer
  # OUT: arraybuffer
  arraybuffer : (url, options = {}) ->

    @triggerRequest(
      url
      options
      (data) ->
        method : "POST"
        body : if data instanceof ArrayBuffer then data else data.buffer.slice(0, data.byteLength)
        headers :
          "Content-Type" : "application/octet-stream"
      (response) ->
        response.arrayBuffer()
    )


  triggerRequest : (url, options, requestDataHandler, responseDataHandler) ->

    defaultOptions =
      method : "GET"
      credentials : "same-origin"
      headers : {}
      doNotCatch : false

    if options.data?
      requestOptions = requestDataHandler(options.data)
    else
      requestOptions = headers: {}

    options = _.assign(
      {},
      defaultOptions,
      options,
      requestOptions
    )
    _headers = _.assign(
      {},
      defaultOptions.headers,
      options.headers,
      requestOptions.headers
    )

    headers = new Headers()
    for name of _headers
      headers.set(name, _headers[name])
    options.headers = headers

    fetchPromise = fetch(url, options)
      .then(@handleStatus)
      .then(responseDataHandler)

    if not options.doNotCatch
      fetchPromise = fetchPromise.catch(@handleError)

    if options.timeout?
      timeoutPromise = new Promise( (resolve, reject) ->
        setTimeout(
          ->
            reject("timeout")
          options.timeout
        )
      )
      return Promise.race([fetchPromise, timeoutPromise])

    return fetchPromise


  handleStatus : (response) ->

    if 200 <= response.status < 300
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
