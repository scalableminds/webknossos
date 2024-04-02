package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import com.scalableminds.webknossos.datastore.models.{BucketPosition, CubePosition}

trait WKWDataFormatHelper {

  val dataFileExtension: String = "wkw"
  val FILENAME_HEADER_WKW: String = s"header.$dataFileExtension"

  protected def wkwFilePath(cube: CubePosition): String =
    f"${cube.mag.toMagLiteral(allowScalar = true)}/${wkwFilePath(cube.x, cube.y, cube.z)}"

  protected def wkwFilePath(x: Int, y: Int, z: Int): String =
    f"z$z/y$y/x$x.$dataFileExtension"

  protected def parseWKWFilePath(path: String): Option[BucketPosition] = {
    val CubeRx = s"(|.*/)(\\d+|\\d+-\\d+-\\d+)/z(\\d+)/y(\\d+)/x(\\d+).$dataFileExtension".r
    path match {
      case CubeRx(_, resolutionStr, z, y, x) =>
        Vec3Int.fromMagLiteral(resolutionStr, allowScalar = true).map { mag =>
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
