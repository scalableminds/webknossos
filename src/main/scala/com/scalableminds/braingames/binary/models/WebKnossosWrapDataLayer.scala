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
    // TODO: currently we are ignoring the settings and use the cube length passed by the cube
    val filePath = "%s/%d/z%d/y%d/x%d.wkw".format(baseDir, cube.resolution, cube.z, cube.y, cube.x)

    WKWFile(new File(filePath))
  }
}
