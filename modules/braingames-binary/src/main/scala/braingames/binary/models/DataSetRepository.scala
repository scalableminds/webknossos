package braingames.binary.models

import scala.concurrent.Future

trait DataSetRepository {
  def deleteAllExcept(l: Array[String])
  def updateOrCreate(dataSet: DataSet)
  def removeByName(name: String)
  def findByName(name: String): Future[Option[DataSet]]
}