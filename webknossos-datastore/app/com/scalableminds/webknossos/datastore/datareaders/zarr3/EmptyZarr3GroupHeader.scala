package com.scalableminds.webknossos.datastore.datareaders.zarr3

import com.scalableminds.util.tools.AutoJsonFormat

case class EmptyZarr3GroupHeader(
    zarr_format: Int = 3, // must be 3
    node_type: String = "group" // must be "group"
) derives AutoJsonFormat

object EmptyZarr3GroupHeader {
  val FILENAME_ZARR_JSON = "zarr.json"
}
