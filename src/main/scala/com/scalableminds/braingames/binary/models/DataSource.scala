/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import play.api.libs.json.Reads
import com.scalableminds.util.geometry.{BoundingBox, Scale, Point3D}
import com.scalableminds.util.geometry.Scale._
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.scalableminds.braingames.binary.models._
import java.io.File
import scalax.file.Path

case class DataSourceSettings(
  id: Option[String],
  scale: Scale,
  priority: Option[Int])

case class DataSource(
  id: String,
  baseDir: String,
  scale: Scale,
  priority: Int = 0,
  dataLayers: List[DataLayer] = Nil
  ) {

  def getDataLayer(name: String) =
    dataLayers.find(_.name == name)

  def getByCategory(category: String) =
    dataLayers.find(_.category == category)

  def sourceFolder = Path.fromString(baseDir)

  def relativeBaseDir(binaryBase: String) = baseDir.replace(binaryBase, "")

  val blockLength = 128

  val blockSize = blockLength * blockLength * blockLength

  lazy val boundingBox = BoundingBox.combine(dataLayers.map(_.boundingBox))

  def pointToBlock(point: Point3D, resolution: Int) =
    Point3D(
      point.x / blockLength / resolution,
      point.y / blockLength / resolution,
      point.z / blockLength / resolution)

  def applyResolution(point: Point3D, resolution: Int) =
    Point3D(
      point.x / resolution,
      point.y / resolution,
      point.z / resolution)

  override def toString() = {
    s"""$id (${dataLayers.map(_.name).mkString(", ")})"""
  }
}

object DataSource{
  implicit val dataSourceFormat = Json.format[DataSource]
}

object DataSourceSettings extends SettingsFile[DataSourceSettings]{

  implicit val dataSourceSettingsFormat = Json.format[DataSourceSettings]

  val settingsFileName = "settings.json"

  val settingsFileReads = dataSourceSettingsFormat

  def fromDataSource(dataSource: DataSource) = DataSourceSettings(
    Some(dataSource.id),
    dataSource.scale,
    Some(dataSource.priority)
  )

  def writeToFolder(dataSource: DataSource, path: Path) = {
    val settings = fromDataSource(dataSource)
    writeSettingsToFile(settings, settingsFileInFolder(path))
  }
}