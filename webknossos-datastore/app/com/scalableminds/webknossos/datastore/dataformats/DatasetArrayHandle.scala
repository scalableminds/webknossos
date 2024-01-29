package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrArray
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}

import scala.concurrent.ExecutionContext

class DatasetArrayHandle(datasetArray: DatasetArray) extends SafeCachable {
  def cutOutBucket(bucket: BucketPosition, dataLayer: DataLayer)(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val shape = Vec3Int.full(bucket.bucketLength)
    val offset = Vec3Int(bucket.topLeft.voxelXInMag, bucket.topLeft.voxelYInMag, bucket.topLeft.voxelZInMag)

    datasetArray.readBytesWithAdditionalCoordinates(shape,
                                                    offset,
                                                    bucket.additionalCoordinates,
                                                    dataLayer.elementClass == ElementClass.uint24)
  }
}
