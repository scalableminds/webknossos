/*
 * Copyright (C) 2011-2017 scalableminds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.io.File

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.wrap.WKWFile
import net.liftweb.common.Box
import play.api.libs.json.Json

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
  implicit val webKnossosWrapDataLayerSettingsFormat =
    Json.format[WebKnossosWrapDataLayerSettings]
}

case class WebKnossosWrapDataLayer(settings: WebKnossosWrapDataLayerSettings) extends FoxImplicits {
  def load(baseDir: String, cube: CubePosition): Box[WKWFile] = {
    val filePath = "%s/%d/x%06d_y%06d_z%06d.wkw".format(baseDir, cube.resolution, cube.x, cube.y, cube.z)

    WKWFile(new File(filePath))
  }
}
