package braingames.binary.models

import braingames.util.Fox

trait DataSourceRepository {
  def deleteAllExcept(l: Array[String])
  def updateOrCreate(dataSource: DataSource)
  def removeByName(name: String)
  def findByName(name: String): Fox[DataSource]
}