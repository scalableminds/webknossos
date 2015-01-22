importScripts('/assets/bower_components/zlib/bin/gzip.min.js')

compress = (event) ->

  input = event.data.data
  jobId = event.data.jobId

  time = (new Date()).getTime()
  gzip = new Zlib.Gzip(input)
  output = gzip.compress()

  self.postMessage({
    jobId : jobId
    result :
      time : ((new Date()).getTime() - time)
      buffer : output
  }, [output.buffer, input.buffer])


self.addEventListener("message", compress, false)
