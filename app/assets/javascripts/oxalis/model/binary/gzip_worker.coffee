importScripts('/assets/bower_components/zlib/bin/gzip.min.js')

compress = (event) ->

  transmitBuffer = event.data
  time = (new Date()).getTime()
  gzip = new Zlib.Gzip(transmitBuffer)
  transmitBuffer = gzip.compress()

  self.postMessage({
    time : ((new Date()).getTime() - time)
    buffer : transmitBuffer
  })


self.addEventListener("message", compress, false)
