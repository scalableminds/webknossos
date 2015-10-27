$      = require("libs/jquery.1.8.deferred-stand-alone.min")
Zlib   = require("gzip")
helper = require("libs/wrapped_dispatched_worker_helper")

GzipWorker =

  compress : (input) ->
    input = new Uint8Array(input) if input instanceof ArrayBuffer
    output = (new Zlib.Gzip(input)).compress()
    return new $.Deferred().resolve(output)

helper(GzipWorker)
