package braingames.binary.store

import braingames.geometry._
import scala.concurrent.Promise
import scala.concurrent.Future
import braingames.util.Math._
import scala.collection.mutable.ArrayBuffer
import akka.actor.Actor
import akka.agent.Agent
import akka.util.Timeout
import scala.concurrent.duration._
import akka.pattern.pipe
import akka.actor.Status
import java.util.concurrent.TimeoutException
import java.io.InputStream
import scala.util._
import scala.concurrent.ExecutionContext.Implicits._
import braingames.binary.models.DataSet
import braingames.binary.models.DataLayer
import braingames.binary.LoadBlock

/**
 * Abstract Datastore defines all method a binary data source (e.q. normal file
 * system or db implementation) must implement to be used
 */

class DataNotFoundException(message: String) extends Exception(s"$message Could not find the data")

abstract class DataStore extends Actor {
  import DataStore._

  /**
   * Loads the data of a given point from the data source
   */
  def load(dataInfo: LoadBlock): Future[Array[Byte]]

  def receive = {
    case request: LoadBlock =>
      val s = sender
      load(request).onComplete {
        case Failure(e) =>
          s ! e
        case Success(d) =>
          s ! d
      }
  }
}

object DataStore {
  def createFilename(dataInfo: LoadBlock) =
    "%s/%s/%d/x%04d/y%04d/z%04d/%s_mag%d_x%04d_y%04d_z%04d.raw".format(
      dataInfo.dataSet.baseDir,
      dataInfo.dataLayerSection.baseDir,
      dataInfo.resolution,
      dataInfo.block.x, dataInfo.block.y, dataInfo.block.z,
      dataInfo.dataSet.name,
      dataInfo.resolution,
      dataInfo.block.x, dataInfo.block.y, dataInfo.block.z)
}