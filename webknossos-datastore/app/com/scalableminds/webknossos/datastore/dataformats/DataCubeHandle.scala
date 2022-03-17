package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.webknossos.datastore.models.BucketPosition
import net.liftweb.common.Box

// To be implemented as handle for a cube (e.g. may correspond to one 1GB wkw file)
trait DataCubeHandle extends SafeCachable {
  def cutOutBucket(bucket: BucketPosition): Box[Array[Byte]]
}
