### define
jquery : $
underscore : _
libs/toast : Toast
fetch : Fetch
###

Request =

  # nothing / json in, json out
  json : (url, options = {}) ->

    @triggerRequest(
      url
      options
      (data) ->
        method : "POST"
        body : JSON.stringify(data)
        headers :
          "Content-Type" : "application/json"
      (response) ->
        response.json()
    )


  # formdata in, json out
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


  urlEncodedForm : (url, options = {}) ->

    @triggerRequest(
      url
      options
      (data) ->
        if typeof(data) == "string"
          formData = data
        else
          formData = data.serialize()

        method : "POST"
        body : formData
        headers :
          "Content-Type" : "application/x-www-form-urlencoded"
      (response) ->
        response.json()
    )


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
        response.arrayBuffer().then( (data) ->
          new Uint8Array(data)
        )
    )


  triggerRequest : (url, options, requestDataHandler, responseDataHandler) ->

    defaultOptions =
      method : "GET"
      credentials : "same-origin"
      headers : {}

    if options.data?
      requestOptions = requestDataHandler(options.data)
    else
      requestOptions = headers: {}

    _.defaults(options, requestOptions, defaultOptions)
    _.defaults(options.headers, requestOptions.headers, defaultOptions.headers)

    headers = new Headers()
    for name of options.headers
      headers.set(name, options.headers[name])

    options.headers = headers

    fetchPromise = fetch(url, options)
      .then(@handleStatus)
      .then(responseDataHandler)
      .catch(@handleError)

    if options.timeout?
      timeoutPromise = new Promise( (resolve, reject) ->
        setTimeout(
          ->
            reject("timeout")
          options.timeout
        )
      )
      Promise.race([fetchPromise, timeoutPromise])
    else
      fetchPromise


  handleStatus : (response) ->

    if 200 <= response.status < 300
      Promise.resolve(response)
    else
      Promise.reject(response)


  handleError : (error) ->

    if error instanceof Response
      error.json().then(
        (json) ->
          json.messages.map((message) ->
            Toast.error(message.error)
          )
          Promise.reject(json)
        (error) ->
          Toast.error(error)
          Promise.reject(error)
      )
    else
      Toast.error(error)
      Promise.reject(error)
