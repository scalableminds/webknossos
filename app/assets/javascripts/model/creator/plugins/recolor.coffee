### define
libs/array_buffer_socket : ArrayBufferSocket
###


class Recolor

  DESCRIPTION : "Recolors the input with a bmp colormap"

  PARAMETER : "raw: Uint8Array of RGBA, 
               name: name of the colormap"

  EXAMPLE : "plugin.process(rawArr, 'blue')"

  BITMAP_HEADER_SIZE : 54
  URL_BASE : "/assets/images/"
  DEFAULT_COLOR : "blue.bmp"


  colormaps : null
  socket : null


  constructor : () ->

    @colormaps = {}
    @socket = @getSocket()
    @addColorMap @DEFAULT_COLOR


  process : (raw, name) ->

    colormap = @colormaps[name]

    unless colormap?
      return raw

    for i in [0..raw.length/4]
      r = raw[i + 0]
      g = raw[i + 1]
      b = raw[i + 2]
      luminance = Math.floor((0.2126*r) + (0.7152*g) + (0.0722*b))
      raw[i + 0] = colormap[luminance + 0]
      raw[i + 1] = colormap[luminance + 1]
      raw[i + 2] = colormap[luminance + 2]

    raw


  addColorMap : (name) ->

    @socket.sender.url = "#{@URL_BASE}#{name}"
    @socket.send()
      .pipe(
        (responseBuffer) =>
          if responseBuffer?
              @colormaps[name] = responseBuffer.subarray(@BITMAP_HEADER_SIZE)

        =>
          console.log "error loading colormap #{name}"
      )
    

  getSocket : () ->
    
    new ArrayBufferSocket(
      senders : [
        new ArrayBufferSocket.XmlHttpRequest("")
      ]
      requestBufferType : Float32Array
      responseBufferType : Uint8Array
    )  
