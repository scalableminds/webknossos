package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer

import scala.concurrent.ExecutionContext

// To be implemented as handle for a cube (e.g. may correspond to one 1GB wkw file)
trait DataCubeHandle extends SafeCachable {
  def cutOutBucket(bucket: BucketPosition, dataLayer: DataLayer)(implicit ec: ExecutionContext): Fox[Array[Byte]]
}
