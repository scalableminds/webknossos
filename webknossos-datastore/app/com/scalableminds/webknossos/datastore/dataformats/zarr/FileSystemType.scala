package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.util.enumeration.ExtendedEnumeration

object FileSystemType extends ExtendedEnumeration {

  type FileSystemType = Value

  val Uri, Local = Value
}
