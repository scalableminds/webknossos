KEY_LEFT = 37
KEY_UP = 38
KEY_RIGHT = 39
KEY_DOWN = 40

KEY_A = 65
KEY_D = 68
KEY_S = 83
KEY_W = 87
KEY_Y = 89
KEY_Q = 81
KEY_E = 70
KEY_C = 67

#Manages if Keys are presed or toggled
class Keyboard

	keysDown = []
	keysToggled = []

	constructor : ->
		for i in [0..127]
			keysDown.push false
			keysToggled.push false

	setKeyDown : (key) ->
    keysDown[key] = true
  
  setKeyUp : (key) ->
    keysToggled[key] = !keysToggled[key]
    keysDown[key] = false

  isKeyToggled : (key) ->
    return keysToggled[key]
  
  isKeyDown : (key) ->
    return keysDown[key]

