/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.models

import scalax.file.Path
import play.api.libs.json.{JsResult, JsValue, Format, Json}

sealed trait DataSourceLike{
  def id: String
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

case class UnusableDataSource(serverUrl: String, id: String, baseDir: String, owningTeam: String, sourceType: String) extends DataSourceLike{
  def sourceFolder: Path = Path.fromString(baseDir)
}

object UnusableDataSource{
  implicit val unusableDataSourceFormat = Json.format[UnusableDataSource]
}

case class UsableDataSource(serverUrl: String, owningTeam: String, sourceType: String, dataSource: DataSource) extends DataSourceLike{
  val id = dataSource.id
}

object UsableDataSource{
  implicit val usableDataSourceFormat = Json.format[UsableDataSource]
}

case class FiledDataSource(owningTeam: String, sourceType: String, dataSource: DataSource) {
  def toUsable(serverUrl: String) =
    UsableDataSource(serverUrl, owningTeam, sourceType, dataSource)
}

object FiledDataSource{
  implicit val filedDataSourceFormat = Json.format[FiledDataSource]
}