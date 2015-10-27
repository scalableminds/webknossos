$                       = require("jquery")
_                       = require("lodash")
WrappedDispatchedWorker = require("libs/wrapped_dispatched_worker")
GzipWorker              = require("worker!./gzip_worker")

Request =

  gzipWorker : new WrappedDispatchedWorker(GzipWorker)

  send : (options) ->
    options.type ||= options.method

    if options.dataType == "blob" or options.dataType == "arraybuffer" or options.formData?

      deferred = $.Deferred()

      return deferred.reject("No url defined").promise() unless options.url

      _.defaults(options, type: "GET", data: null)

      if options.data
        options.data = JSON.stringify(options.data)
        options.contentType = "application/json" unless options.contentType
      else
        if options.formData?
          if options.formData instanceof FormData
            options.data = options.formData
          else
            options.data = new FormData()
            options.data.append(key, value) for key, value of options.formData
        else if options.multipartData?
          options.data = options.multipartData
          options.contentType = "multipart/mixed; boundary=#{options.multipartBoundary}"

      options.contentEncoding = "gzip" if options.compress and not options.contentEncoding
      options.type = "POST" if options.type == "GET" and options.data

      xhr = new XMLHttpRequest()
      xhr.open options.type, options.url, true
      xhr.responseType = options.dataType if options.dataType?
      xhr.setRequestHeader("Content-Type", options.contentType) if options.contentType
      xhr.setRequestHeader("Content-Encoding", options.contentEncoding) if options.contentEncoding

      xhr.onload = ->
        if @status == 200
          deferred.resolve(@response)
        else
          deferred.reject(xhr)

      xhr.onerror = (err) ->
        deferred.reject(err)

      if options.compress
        @gzipWorker.send(
          method : "compress"
          args : [options.data]
        ).then( (buffer) =>
          xhr.send(buffer)
        )
      else
        xhr.send(options.data)

      if options.timeout?
        setTimeout(
          -> deferred.reject("timeout")
          options.timeout
        )

      deferred.promise()

    else

      if options.data
        options.data = JSON.stringify(options.data)
        options.contentType = "application/json" unless options.contentType

      $.ajax(options)

module.exports = Request
