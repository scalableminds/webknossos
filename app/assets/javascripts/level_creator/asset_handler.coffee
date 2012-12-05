### define ###


class AssetHandler

  constructor : ->


  $form = $("#fileupload")

  $("#assets").find("[type=submit]").click (event) ->


    event.preventDefault()

    $input = $("<input>", type : "file", name : "asset", class : "hide", multiple : true)

    $input.change ->
      if @files.length

        for key, file of @files
          $("#assets tbody").append("<tr><td>#{file.name}</td><td><a href=\"#\"><i class=\"icon-trash\"></i></a></td></tr>")

        $form.append(@)
        $form.submit()


    $input.click()

  fetchAsset : (name) ->