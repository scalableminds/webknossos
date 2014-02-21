/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package braingames.binary.repository

import scalax.file.Path
import braingames.binary.models.{DataSourceLike, UnusableDataSource, DataSource}
import akka.agent.Agent
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import org.apache.commons.io.FileUtils
import braingames.binary.Logger._

trait DataSourceTypeHandler {
  def transformToDataSource(unusableDataSource: UnusableDataSource): Option[DataSource]
}

trait DataSourceTypeGuesser {
  val MaxNumberOfFilesForGuessing = 10

  def chanceOfInboxType(source: Path): Double
}

trait DataSourceType extends DataSourceTypeGuesser with DataSourceTypeHandler {
  def name: String
}

object DataSourceRepository {

  val dataSources = Agent[List[DataSourceLike]](Nil)

  val types = List(KnossosDataSourceType, TiffDataSourceType)

  def guessRepositoryType(source: Path) =
    types.maxBy(_.chanceOfInboxType(source))

  protected def writeDataSourceToFile(path: Path, dataSource: DataSource) = {
    (path / "datasource.json").fileOption.map {
      file =>
        val json = Json.toJson(dataSource)
        FileUtils.write(file, Json.prettyPrint(json))
        dataSource
    }
  }

  def transformToDataSource(unusableDataSource: UnusableDataSource): Option[DataSource] = {
    types
      .maxBy(_.chanceOfInboxType(unusableDataSource.sourceFolder))
      .transformToDataSource(unusableDataSource)
      .flatMap {
      dataSource =>
        writeDataSourceToFile(unusableDataSource.sourceFolder, dataSource)
    }
  }
}
