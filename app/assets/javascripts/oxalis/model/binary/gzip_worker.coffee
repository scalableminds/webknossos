### define
libs/jquery.1.8.deferred-stand-alone.min : __deferred
gzip : gzip
###

GzipWorker =

  compress : (input) ->

    time = (new Date()).getTime()
    gzip = new Zlib.Gzip(input)
    output = gzip.compress()

    return new $.Deferred().resolve(output)
