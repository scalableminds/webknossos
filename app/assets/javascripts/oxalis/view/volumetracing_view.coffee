### define 
jquery : $
../../libs/toast : Toast
./modal : modal
../view : View
###

class VolumeTracingView extends View

  constructor : (@model) ->

    super(@model)

    $('.skeleton-controls').hide()