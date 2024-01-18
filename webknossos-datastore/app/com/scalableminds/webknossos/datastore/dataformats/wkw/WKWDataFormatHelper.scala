package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.models.{BucketPosition, CubePosition}
import net.liftweb.common.{Box, Failure, Full}

trait WKWDataFormatHelper {

  val dataFileExtension: String = "wkw"
  val headerFileName: String = s"header.$dataFileExtension"

  protected def wkwFilePath(cube: CubePosition): String =
    wkwFilePath(cube.x, cube.y, cube.z)

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
