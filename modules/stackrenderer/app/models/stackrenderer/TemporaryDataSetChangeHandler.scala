package models.stackrenderer

import brainflight.io.DataSetChangeHandler
import TemporaryStores._
import models.binary.DataSet
import play.api.libs.concurrent.Akka
import akka.actor.Props
import brainflight.io._

class TemporaryDataSetChangeHandler extends DataSetChangeHandler {
  def deleteAllDataSetsExcept(l: Array[String]) = {
    dataSetStore.removeAllExcept(l)
  }

  def updateOrCreateDataSet(d: DataSet) = {
    dataSetStore.insert(d.name, d)
  }

  def removeDataSetByName(name: String) = {
    dataSetStore.remove(name)
  }
}

object TemporaryDataSetWatcher {
  def start(binaryDataFolder: String)(implicit sys: akka.actor.ActorSystem) = {
    lazy val DirectoryWatcher = sys.actorOf(
      Props(new DirectoryWatcherActor(new TemporaryDataSetChangeHandler)),
      name = "directoryWatcher")
    DirectoryWatcher ! StartWatching(binaryDataFolder)
    DirectoryWatcher
  }
}