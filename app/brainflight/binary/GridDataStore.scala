package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream }
import scala.collection.JavaConverters._
import models.binary.DataSet
import akka.agent.Agent
import scala.io.Codec.charset2codec
import reactivemongo.api._
import reactivemongo.api.gridfs._
import reactivemongo.bson.BSONDocument
import reactivemongo.bson.BSONObjectID
import reactivemongo.bson._
import reactivemongo.bson.handlers.DefaultBSONHandlers._
import play.api.libs.iteratee.Iteratee
import scala.collection.mutable.ArrayBuffer
import play.api.libs.iteratee.Enumerator
import java.io.File
import scala.concurrent.Future
import play.api.libs.concurrent.Promise
import play.api.libs.concurrent.Execution.Implicits._
import models.GridDataSetPairing
import play.api.libs.concurrent.Akka
import play.api.Play.current
import play.api.libs.iteratee.Input
import play.api.libs.iteratee.Done
import models.binary.DataLayer
import akka.actor.Actor
import scala.concurrent.Promise
import play.api.libs.iteratee.Cont

case class InsertBinary(dataSet: DataSet)
case class InsertionState()

class BinaryData2DBActor extends Actor {
  val insertionState = Agent[Map[DataSet, (Int, Int)]](Map())(Akka.system)

  //GridFs handle
  lazy val connection = MongoConnection(List("localhost:27017"))
  // a GridFS store named 'attachments'

  val gridFS = new BinaryDataFS(DB("binaryData", connection), "binarydata")

  def receive = {
    case InsertBinary(dataSet) =>
      Future {
        create(dataSet)
      }
    case InsertionState() =>
      val state = insertionState()
      sender ! state.mapValues(i => i._1 / i._2.toDouble)
  }

  def create(dataSet: DataSet) = {
    val resolution = 1
    dataSet.dataLayers.get("color").map { dataLayer =>
      GridDataSetPairing.getOrCreatePrefix(dataSet, dataLayer, 1).map { prefix =>
        val max = dataSet.maxCoordinates
        val maxX = ((max.x / 128.0).ceil - 1).toInt
        val maxY = ((max.y / 128.0).ceil - 1).toInt
        val maxZ = ((max.z / 128.0).ceil - 1).toInt

        var idx = 0
        val maxAll = maxX * maxY * maxZ
        for {
          x <- 0 to maxX
          y <- 0 to maxY
          z <- 0 to maxZ
        } {
          val blockInfo = LoadBlock(dataSet.baseDir, dataSet.name, dataLayer.folder, dataLayer.bytesPerElement, resolution, x, y, z)
          val f = new File(DataStore.createFilename(blockInfo))
          val blockId = GridDataStore.blockToId(prefix, x, y, z)
          val it = gridFS.save(blockId, Some(new BSONObjectID(blockId)), Some("application/binary"))
          Enumerator.fromFile(f)(it).map(_.mapDone { future =>
            future.map(result =>
              insertionState send { d =>
                val p = d.get(dataSet) getOrElse (0 -> 0)
                d.updated(dataSet, (p._1 + 1 -> maxAll))
              })
          })
          idx += 1
        }
      }
    }
  }
}

class GridDataStore
    extends DataStore {
  import DataStore._
  //GridFs handle
  lazy val connection = MongoConnection(List("localhost:27017"))
  // a GridFS store named 'attachments'

  val gridFS = new BinaryDataFS(DB("binaryData", connection), "binarydata")

  // let's build an index on our gridfs chunks collection if none
  gridFS.ensureIndex()

  def load(blockInfo: LoadBlock): Future[Array[Byte]] = {
    GridDataSetPairing.findPrefix(blockInfo.dataSetName, blockInfo.dataLayerName, blockInfo.resolution).flatMap {
      _ match {
        case Some(prefix) =>
          val r = gridFS.find(BSONDocument(
            "_id" -> new BSONObjectID(GridDataStore.blockToId(prefix, blockInfo.x, blockInfo.y, blockInfo.z)))).toList
          val it = Iteratee.consume[Array[Byte]]()

          r.flatMap {
            case file :: _ =>
              val e = file.enumerate
              e.run(it)
            case _ =>
              Future.failed(new DataNotFoundException("GRIDFS1"))
          }
        case _ =>
          Future.failed(new DataNotFoundException("GRIDFS2"))
      }
    }
  }
}

object GridDataStore {
  def blockToId(prefix: Long, x: Int, y: Int, z: Int): String = {
    "%012d%04d%04d%04d".format(prefix, x, y, z)
  }
}