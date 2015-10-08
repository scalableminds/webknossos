require("libs/jquery.1.8.deferred-stand-alone.min")

gzip   = require("gzip")
helper = require("libs/wrapped_dispatched_worker_helper")

GzipWorker =

  compress : (input) ->

    output = (new Zlib.Gzip(input)).compress()
    return new $.Deferred().resolve(output)

helper(GzipWorker)
