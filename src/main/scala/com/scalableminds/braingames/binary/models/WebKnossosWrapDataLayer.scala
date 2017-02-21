/*
 * Copyright (C) 2011-2017 scalableminds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.io.File
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.wrap.WKWFile
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

case class WebKnossosWrapDataLayerSettings(
                                            name: String,
                                            typ: String,
                                            `class`: String,
                                            fileLength: Int,
                                            blockLength: Int,
                                            voxelSize: Int,
                                            resolutions: List[Int],
                                            boundingBox: List[List[Int]])

object WebKnossosWrapDataLayerSettings {
  implicit val webKnossosWrapDataLayerSettingsFormat = Json.format[WebKnossosWrapDataLayerSettings]
}

case class WebKnossosWrapDataLayer(settings: WebKnossosWrapDataLayerSettings) extends FoxImplicits {
  def load(block: LoadBlock): Fox[Array[Byte]] = {
    val fileCoords = new Point3D(
      block.block.x / settings.fileLength,
      block.block.y / settings.fileLength,
      block.block.z / settings.fileLength
    )
    val blockOffset = new Point3D(
      block.block.x % settings.fileLength,
      block.block.y % settings.fileLength,
      block.block.z % settings.fileLength
    )

    val filePath = "%s/%d/z%d/y%d/x%d.wkw".format(block.dataLayer.baseDir, block.resolution, fileCoords.z, fileCoords.y, fileCoords.x)

    for {
      wkwFile <- WKWFile(new File(filePath))
      data <- wkwFile.readBlock(blockOffset.x, blockOffset.y, blockOffset.z)
    } yield {
      data
    }
  }
}
