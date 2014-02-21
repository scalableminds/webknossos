/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.models

import scalax.file.Path

case class UnusableDataSource(id: String, baseDir: String, owningTeam: String, sourceType: String) extends DataSourceLike{
  def sourceFolder: Path = Path.fromString(baseDir)
}