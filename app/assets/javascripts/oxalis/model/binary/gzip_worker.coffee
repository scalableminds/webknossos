importScripts('/assets/bower_components/zlib/bin/gzip.min.js')

compress = (event) ->

  transmitBuffer = event.data.data
  jobId = event.data.jobId

  time = (new Date()).getTime()
  gzip = new Zlib.Gzip(transmitBuffer)
  transmitBuffer = gzip.compress()

  self.postMessage({
    jobId : jobId
    result :
      time : ((new Date()).getTime() - time)
      buffer : transmitBuffer
  })


self.addEventListener("message", compress, false)
