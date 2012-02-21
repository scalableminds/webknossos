controllKeys = [37, 38, 39, 40, 65, 68, 83, 87, 89, 81, 70, 67, 32, 88]

KEY_LEFT = 37
KEY_UP = 38
KEY_RIGHT = 39
KEY_DOWN = 40
KEY_SPACE = 32

KEY_A = 65
KEY_D = 68
KEY_S = 83
KEY_W = 87
KEY_Y = 89
KEY_Q = 81
KEY_E = 70
KEY_C = 67
KEY_X = 88

#Manages if Keys are presed or toggled
class Keyboard

  keysDown = []
  keysToggled = []

  constructor : ->
    @onChange = null
    for i in [0..127]
      keysDown.push false
      keysToggled.push false

  setKeyDown : (key) ->
    keysDown[key] = true
    @changed()
  
  setKeyUp : (key) ->
    keysToggled[key] = !keysToggled[key]
    keysDown[key] = false
    @changed()

  isKeyToggled : (key) ->
    return keysToggled[key]
  
  isKeyDown : (key) ->
    return keysDown[key]

  changed : () ->
    if @onChange isnt null
      countKeysDown = 0
      for i in [0..127]
        if keysDown[i] is true 
          countKeysDown++  if _.indexOf(controllKeys, i) isnt -1

      @onChange countKeysDown

