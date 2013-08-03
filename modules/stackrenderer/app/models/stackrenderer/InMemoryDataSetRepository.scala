package models.stackrenderer

import TemporaryStores._
import braingames.binary.models.{DataSetRepository, DataSet}
import play.api.libs.concurrent.Akka
import akka.actor.Props
import braingames.io.{DirectoryWatcherActor}
import scala.concurrent.Future

object InMemoryDataSetRepository extends DataSetRepository {
  def deleteAllExcept(l: Array[String]) = {
    dataSetStore.removeAllExcept(l)
  }

  def findByName(name: String) = {
    Future.successful(dataSetStore.find(name))
  }

  def updateOrCreate(d: DataSet) = {
    dataSetStore.insert(d.name, d)
  }

  def removeByName(name: String) = {
    dataSetStore.remove(name)
  }
}