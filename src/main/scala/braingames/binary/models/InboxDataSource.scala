/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.models

import scalax.file.Path
import play.api.libs.json.Json

trait DataSourceLike{
  def id: String
}

case class UnusableDataSource(id: String, baseDir: String, owningTeam: String, sourceType: String) extends DataSourceLike{
  def sourceFolder: Path = Path.fromString(baseDir)
}

case class UsableDataSource(owningTeam: String, sourceType: String, dataSource: DataSource) extends DataSourceLike{
  val id = dataSource.id
}

object UsableDataSource{
  implicit val usableDataSourceFormat = Json.format[UsableDataSource]
}