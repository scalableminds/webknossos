### define
libs/request : Request
routes : Routes
###


class AssetHandler

  constructor : ( @levelName ) ->


    $form = $("#assets-upload")

    $form.find("[type=submit]").click (event) =>

      event.preventDefault()

      $input = $("<input>", type : "file", class : "hide", multiple : true)

      input = $input[0]
      $input.change =>

        return unless input.files.length

        formData = new FormData()
        formData.append("asset", file) for file in input.files

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
                  <a href="#{Routes.controllers.admin.LevelCreator.deleteAsset(@levelName, file.name).url}" data-ajax="confirm,delete-row"><i class="icon-trash"></i>
                  </a>
                </td>
              </tr>""")

      $input.click()

  fetchAsset : (name) ->