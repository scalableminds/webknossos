### define
libs/jquery.1.8.deferred-stand-alone.min : __deferred
gzip : gzip
###

GzipWorker =

  compress : (input) ->

    output = (new Zlib.Gzip(input)).compress()
    return new $.Deferred().resolve(output)
