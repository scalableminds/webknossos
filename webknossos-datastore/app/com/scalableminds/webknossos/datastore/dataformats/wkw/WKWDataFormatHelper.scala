package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.BucketPosition

trait WKWDataFormatHelper {

  val dataFileExtension: String = "wkw"
  val FILENAME_HEADER_WKW: String = s"header.$dataFileExtension"

  // Assumes single-bucket wkw files, as for volume tracings
  protected def wkwFilePath(bucket: BucketPosition): String =
    f"${bucket.mag.toMagLiteral(allowScalar = true)}/${wkwFilePath(bucket.bucketX, bucket.bucketY, bucket.bucketZ)}"

  protected def wkwFilePath(x: Int, y: Int, z: Int): String =
    f"z$z/y$y/x$x.$dataFileExtension"

  // Assumes single-bucket wkw files, as for volume tracings
  protected def parseWKWFilePath(path: String): Option[BucketPosition] = {
    val CubeRx = s"(|.*/)(\\d+|\\d+-\\d+-\\d+)/z(\\d+)/y(\\d+)/x(\\d+).$dataFileExtension".r
    path match {
      case CubeRx(_, magStr, z, y, x) =>
        Vec3Int.fromMagLiteral(magStr, allowScalar = true).map { mag =>
          BucketPosition(x.toInt * mag.x * DataLayer.bucketLength,
                         y.toInt * mag.y * DataLayer.bucketLength,
                         z.toInt * mag.z * DataLayer.bucketLength,
                         mag,
                         None)
        }
      case _ =>
        None
    }
  }

}
