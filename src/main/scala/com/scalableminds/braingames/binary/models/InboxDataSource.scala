/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

import java.nio.file.{Paths, Path}
import play.api.libs.json.{JsResult, JsValue, Format, Json}

sealed trait DataSourceLike{
  def id: String

  def isUsable: Boolean

  def owningTeam: String

  def sourceType: String

  def source: Option[DataSource]

  def serverUrl: String
}

object DataSourceLike{

  implicit object dataSourceLikeWrites extends Format[DataSourceLike]{
    override def writes(o: DataSourceLike): JsValue = o match{
      case u: UnusableDataSource => UnusableDataSource.unusableDataSourceFormat.writes(u)
      case u: UsableDataSource => UsableDataSource.usableDataSourceFormat.writes(u)
    }

    override def reads(json: JsValue): JsResult[DataSourceLike] = {
      UsableDataSource.usableDataSourceFormat.reads(json) orElse UnusableDataSource.unusableDataSourceFormat.reads(json)
    }
  }
}

case class UnusableDataSource(serverUrl: String, id: String, baseDir: String, owningTeam: String, sourceType: String) extends DataSourceLike {
  def sourceFolder: Path = Paths.get(baseDir)

  def source = None

  val isUsable = false
}

object UnusableDataSource{
  implicit val unusableDataSourceFormat = Json.format[UnusableDataSource]
}

case class UsableDataSource(serverUrl: String, owningTeam: String, sourceType: String, dataSource: DataSource) extends DataSourceLike {
  val id = dataSource.id

  val isUsable = true

  def source = Some(dataSource)

  def toUnusable: UnusableDataSource =
    UnusableDataSource(serverUrl, dataSource.id, dataSource.baseDir, owningTeam, sourceType)
}

object UsableDataSource{
  implicit val usableDataSourceFormat = Json.format[UsableDataSource]
}

case class FiledDataSource(sourceType: String, dataSource: DataSource) {
  def toUsable(serverUrl: String, owningTeam: String) =
    UsableDataSource(serverUrl, owningTeam, sourceType, dataSource)
}

object FiledDataSource{
  implicit val filedDataSourceFormat = Json.format[FiledDataSource]
}