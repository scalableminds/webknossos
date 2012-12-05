### define ###

class AssetHandler

  constructor : ->


  $form = $("#fileupload")

  $("#assets").find("[type=submit]").click ->

    $input = $("<input>", type : "file", name : "nmlFile", class : "hide", multiple : true)

    $input.change ->
      if this.files.length

        console.log this.files

        this.files.forEach( file, ->
          $("#assets tbody").append("<tr><td>#{file.name}</td><td><a href=\"#\"><i class=\"icon-trash\"></i></a></td></tr>")
        )

        $form.submit()


    $input.click()

  fetchAsset : (name) ->