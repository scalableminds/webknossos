### define
libs/jquery-fileupload/jquery.fileupload : FileUpload
###

class AssetHandler

  constructor : ->

  $("#").click ->

    $input = $("<input>", type : "file", name : "nmlFile", class : "hide")

    $input.change ->
      if this.files.length
        $form.append(this)
        $form.submit()

    $input.click()
