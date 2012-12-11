### define
libs/request : Request
routes : Routes
###


class AssetHandler

  WINDOW_URL : window.URL || window.webkitURL

  constructor : ( @levelId ) ->

    @assetStore = {}

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

    Request.send(
      url : Routes.controllers.admin.LevelCreator.listAssets(@levelId).url
      dataType : "json"
    ).done (assets) =>
      @loadAsset(asset) for asset in assets
      return

  
  loadAsset : (name) ->

    Request.send(
      url : Routes.controllers.admin.LevelCreator.retrieveAsset(@levelId, name).url
      dataType : "arraybuffer"
    ).done (data) =>
      @assetStore[name] = data


  getArrayBuffer : (name) ->

    throw new Error("Asset not found.") unless @assetStore[name]?
    @assetStore[name]


  getArray : (name, arrayType = Uint8Array) ->

    new arrayType(@getArrayBuffer(name))


  getBlob : (name) ->

    new Blob([ @getArray(name) ])


  getImage : (name, mimeType = "image/png") ->

    console.warn("AssetHandler.getImage returns an image which is asynchronously populated.")

    blob = @getBlob(name).slice(0, -1, mimeType)

    image = new Image()
    image.onload = =>
      @WINDOW_URL.revokeObjectURL(image.src)
    image.src = @WINDOW_URL.createObjectURL(blob)

    image



