### define
jquery : $
underscore : _
libs/toast : Toast
libs/keyboard : KeyboardJS
###

$ ->
      require ["./iso_shader"], (IsoShader) ->

        window.isoShader = new IsoShader()