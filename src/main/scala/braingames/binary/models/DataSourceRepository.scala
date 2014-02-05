package braingames.binary.models

import scala.concurrent.Future

trait DataSourceRepository {
  def deleteAllExcept(l: Array[String])
  def updateOrCreate(dataSource: DataSource)
  def removeByName(name: String)
  def findByName(name: String): Future[Option[DataSource]]
}