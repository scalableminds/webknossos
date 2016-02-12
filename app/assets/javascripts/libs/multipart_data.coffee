$ = require("jquery")

class MultipartData

  randomBoundary : ->

    '--multipart-boundary--xxxxxxxxxxxxxxxxxxxxxxxx--'.replace(/[x]/g,
      ->
        (Math.random() * 16 | 0).toString(16))


  constructor : (@boundary) ->

    @boundary = @boundary || @randomBoundary()
    @data = ['--' + @boundary + '\r\n']


  addPart : (headers, body) ->

    for name, value of headers
      @data.push(name + ': ' + value + '\r\n')

    @data.push('\r\n')
    @data.push(body) if body?
    @data.push('\r\n--' + @boundary + '\r\n')


  dataPromise : ->

    deferred = new $.Deferred()

    reader = new FileReader()
    reader.onload = (e) =>
      deferred.resolve(e.target.result)

    reader.readAsArrayBuffer(new Blob(@data))

    return deferred.promise()


module.exports = MultipartData
