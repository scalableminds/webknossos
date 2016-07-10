Constants =

  PLANE_XY             : 0
  PLANE_YZ             : 1
  PLANE_XZ             : 2
  TDView               : 3
  ARBITRARY_VIEW       : 4
  PLANE_NAMES          : ["xy", "yz", "xz"]
  ALL_PLANES           : [0, 1, 2]
  ALL_VIEWPORTS        : [0, 1, 2, 3]
  PLANE_COLORS         : [0xff0000, 0x0000ff, 0x00ff00, 0xffffff]

  MODE_PLANE_TRACING   : 0
  MODE_ARBITRARY       : 1
  MODE_ARBITRARY_PLANE : 2
  MODE_VOLUME          : 3
  MODES_PLANE          : [0, 3]
  MODES_ARBITRARY      : [1, 2]
  MODES_SKELETON       : [0, 1, 2]
  MODE_NAME_TO_ID      : {
    "orthogonal" : 0,
    "flight" : 1,
    "oblique" : 2,
    "volume" : 3,
  }

  CONTROL_MODE_TRACE   : 0
  CONTROL_MODE_VIEW    : 1

  VOLUME_MODE_MOVE     : 0
  VOLUME_MODE_TRACE    : 1

  DEFAULT_SEG_ALPHA    : 20

  THEME_BRIGHT         : 0
  THEME_DARK           : 1

  PLANE_WIDTH          : 376
  VIEWPORT_WIDTH       : 384
  TEXTURE_WIDTH        : 512
  TEXTURE_SIZE_P       : 9
  DISTANCE_3D          : 140

  TDView_MOVE_SPEED    : 150
  MIN_MOVE_VALUE       : 30
  MAX_MOVE_VALUE       : 14000

  FPS                  : 50

  MIN_SCALE            : 0.05
  MAX_SCALE            : 20

  MIN_PARTICLE_SIZE    : 1
  MAX_PARTICLE_SIZE    : 20

  ZOOM_DIFF            : 0.1

  RESIZE_THROTTLE_TIME : 250

module.exports = Constants
