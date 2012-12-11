### define
underscore : _
jquery : $
libs/event_mixin : EventMixin
libs/request : Request
routes : Routes
###


class AssetHandler

  WINDOW_URL : window.URL || window.webkitURL
  SUPPORTED_IMAGE_TYPES :
    ".bmp" : "image/bitmap"
    ".jpg" : "image/jpeg"
    ".gif" : "image/gif"
    ".png" : "image/png"

  constructor : ( @levelId ) ->

    _.extend(this, new EventMixin())

    @assetStore = {}
    @imageStore = {}

    $form = $("#assets-upload")

    $form.find("[type=submit]").click (event) =>

      event.preventDefault()

      $input = $("<input>", type : "file", class : "hide", multiple : true)

      input = $input[0]
      $input.change =>

        return unless input.files.length

        formData = new FormData()
        for file in input.files
          do (file) =>
            formData.append("asset", file) 

            fileReader = new FileReader()
            fileReader.onload = (e) => @assetStore[file.name] = e.target.result
            fileReader.readAsArrayBuffer(file)

        Request.send(
          url : $form[0].action
          formData : formData
          type : "POST"
        ).done =>

          for file in input.files
            $("#assets tbody").append("""
              <tr>
                <td>#{file.name}</td>
                <td>
                  <a href="#{Routes.controllers.admin.LevelCreator.deleteAsset(@levelId, file.name).url}" data-ajax="confirm,delete-row"><i class="icon-trash"></i>
                  </a>
                </td>
              </tr>""")

      $input.click()

    #### init

    Request.send(
      url : Routes.controllers.admin.LevelCreator.listAssets(@levelId).url
      dataType : "json"
    ).done (assets) =>
      deferreds = (@loadAsset(asset) for asset in assets)
      $.when(deferreds...).done => @trigger("initialized")

      return

  
  loadAsset : (name) ->

    Request.send(
      url : Routes.controllers.admin.LevelCreator.retrieveAsset(@levelId, name).url
      dataType : "arraybuffer"
    ).done (data) =>

      @assetStore[name] = data

      extension = name.substring(name.lastIndexOf("."))
      if @SUPPORTED_IMAGE_TYPES[extension]?

        blob = @getBlob(name, @SUPPORTED_IMAGE_TYPES[extension])

        deferred = new $.Deferred()

        image = new Image()
        image.onload = =>
          @WINDOW_URL.revokeObjectURL(image.src)
          @imageStore[name] = image
          deferred.resolve()

        image.src = @WINDOW_URL.createObjectURL(blob)

        deferred

      else
        true


  getArrayBuffer : (name) ->

    throw new Error("Asset \"#{name}\" not found.") unless @assetStore[name]?
    @assetStore[name]


  getArray : (name, arrayType = Uint8Array) ->

    new arrayType(@getArrayBuffer(name))


  getBlob : (name, mimeType) ->

    if mimeType?
      new Blob([ @getArray(name) ], type : mimeType )
    else
      new Blob([ @getArray(name) ])



  getImage : (name) ->

    throw new Error("Image \"#{name}\" not found.") unless @imageStore[name]?
    @imageStore[name]


  getPixelArray : (name) ->

    image = @getImage(name)

    canvas = $("<canvas>")[0]
    context = canvas.getContext("2d")
    canvas.width = image.width
    canvas.height = image.height
    context.drawImage(image, 0, 0)
    context.getImageData(0, 0, canvas.width, canvas.height).data



