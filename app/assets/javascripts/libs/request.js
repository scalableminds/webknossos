_             = require("lodash")
Toast         = require("./toast")
ErrorHandling = require("./error_handling")
pako          = require("pako")

Request =

  # IN:  nothing
  # OUT: json
  receiveJSON : (url, options = {}) ->

    return @triggerRequest(
      url,
      _.defaultsDeep(options, { headers : { "Accept": "application/json" }}),
      @handleEmptyJsonResponse
    )


  # IN:  json
  # OUT: json
  sendJSONReceiveJSON : (url, options = {}) ->

    # Sanity check
    # Requests without body should not send 'json' header and use 'receiveJSON' instead
    if not options.data
      if options.method == "POST" or options.method == "PUT"
        console.warn("Sending POST/PUT request without body", url)
      return @receiveJSON(url, options)

    body = if typeof(options.data) == "string"
        options.data
      else
        JSON.stringify(options.data)

    return @receiveJSON(
      url,
      _.defaultsDeep(options, {
        method : "POST"
        body : body
        headers :
          "Content-Type" : "application/json"
      })
    )


  # IN:  multipart formdata
  # OUT: json
  sendMultipartFormReceiveJSON : (url, options = {}) ->

    toFormData = (input, form, namespace) ->
      formData = form || new FormData()

      for key, value of input

        if namespace
          formKey = "#{namespace}[#{key}]"
        else
          formKey = key

        if _.isArray(value)
          for val in value
            formData.append("#{formKey}[]", val)

        else if value instanceof File
          formData.append("#{formKey}[]", value, value.name)

        else if _.isObject(value)
          toFormData(value, formData, key)

        else # string
          ErrorHandling.assert(_.isString(value))
          formData.append(formKey, value)

      return formData


    body = if options.data instanceof FormData
        options.data
      else
        toFormData(options.data)


    return @receiveJSON(
      url,
      _.defaultsDeep(options, {
        method : "POST"
        body : body
      })
    )


  # IN:  url-encoded formdata
  # OUT: json
  sendUrlEncodedFormReceiveJSON : (url, options = {}) ->

    body = if typeof options.data == "string"
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

    if options.compress
      body = pako.gzip(body)
      options.headers["Content-Encoding"] = "gzip"

    return @receiveArraybuffer(
      url,
      _.defaultsDeep(options,
        method : "POST"
        body : body
        headers :
          "Content-Type" : "application/octet-stream"
      )
    )


  triggerRequest : (url, options={}, responseDataHandler) ->

    defaultOptions =
      method : "GET"
      host : ""
      credentials : "same-origin"
      headers : {}
      doNotCatch : false
      params : null

    options = _.defaultsDeep(options, defaultOptions)

    if options.host
      url = options.host + url

    # Append URL parameters to the URL
    if options.params
      params = options.params

      if _.isString(params)
        appendix = params
      else if _.isObject(params)
        appendix = _.map(params, (value, key) -> return "#{key}=#{value}").join("&")
      else
        throw new Error("options.params is expected to be a string or object for a request!")

      url += "?#{appendix}"


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
        .then((result) ->
          if result == "timeout"
            throw new Error("Timeout")
          else
            return result
        )
    else
      return fetchPromise


  timeoutPromise : (timeout) ->

    return new Promise( (resolve, reject) ->
      setTimeout(
        -> resolve("timeout")
        timeout
      )
    )


  handleStatus : (response) ->

    if 200 <= response.status < 400
      return Promise.resolve(response)

    return Promise.reject(response)


  handleError : (error) ->

    if error instanceof Response
      error.text().then(
        (text) ->
          try
            json = JSON.parse(text)

            # Propagate HTTP status code for further processing down the road
            json.status = error.status

            Toast.message(json.messages)
            Promise.reject(json)
          catch error
            Toast.error(text)
            Promise.reject(text)
        (error) ->
          Toast.error(error.toString())
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


module.exports = Request
