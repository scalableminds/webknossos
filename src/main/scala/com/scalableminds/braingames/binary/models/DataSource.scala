/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.nio.file.{Paths, Path}
import com.scalableminds.braingames.binary.repository.KnossosDataSourceType

import com.scalableminds.util.geometry.{BoundingBox, Scale, Point3D}
import play.api.libs.json._

case class DataSourceSettings(
  id: Option[String],
  scale: Scale,
  priority: Option[Int])

case class DataSource(
  id: String,
  baseDir: String,
  scale: Scale,
  priority: Int = 0,
  dataLayers: List[DataLayer] = Nil,
  sourceType: Option[String] = Some(KnossosDataSourceType.name),
  blockLengthOpt: Option[Int] = Some(128)
  ) {

  def getDataLayer(name: String) =
    dataLayers.find(_.name == name)

  def getByCategory(category: String) =
    dataLayers.find(_.category == category)

  def sourceFolder = Paths.get(baseDir)

  def relativeBaseDir(binaryBase: String) = baseDir.replace(binaryBase, "")

  def blockLength: Int = blockLengthOpt.getOrElse(128)

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