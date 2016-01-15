$      = require("libs/jquery.1.8.deferred-stand-alone.min")
pako   = require("pako")
helper = require("libs/wrapped_dispatched_worker_helper")

GzipWorker =

  compress : (input) ->

    return new $.Deferred().resolve(pako.gzip(input))

helper(GzipWorker)
