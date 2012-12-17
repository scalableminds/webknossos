package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream }
import scala.collection.JavaConverters._
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D
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
import play.api.libs.concurrent.execution.defaultContext
import models.GridDataSetPairing
import play.api.libs.concurrent.Akka
import play.api.Play.current
import play.api.libs.iteratee.Input
import play.api.libs.iteratee.Done
import models.binary.DataLayer
import akka.actor.Actor

case class InsertBinary(dataSet: DataSet)
case class InsertionState()

class BinaryData2DBActor extends Actor {
  val insertionState = Agent[Map[DataSet, Double]](Map())(Akka.system)

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
      sender ! insertionState()
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
        val maxAll: Double = maxX * maxY * maxZ
        for {
          x <- 0 to maxX
          y <- 0 to maxY
          z <- 0 to maxZ
        } {
          val block = Point3D(x, y, z)
          val f = new File(DataStore.createFilename(dataSet, dataLayer, resolution, block))
          val blockId = GridDataStore.point3DToId(prefix, block)
          val it = gridFS.save(blockId, Some(new BSONObjectID(blockId)), Some("application/binary"))
          val progress = idx / maxAll
          Enumerator.fromFile(f)(it).map(_.mapDone { future =>
            future.map(result =>
              insertionState send (_.updated(dataSet, progress)))
          })
          idx += 1
        }
      }
    }
  }
}

class GridDataStore(cacheAgent: Agent[Map[DataBlockInformation, Data]])
    extends CachedDataStore(cacheAgent) {
  import DataStore._
  //GridFs handle
  lazy val connection = MongoConnection(List("localhost:27017"))
  // a GridFS store named 'attachments'

  val gridFS = new BinaryDataFS(DB("binaryData", connection), "binarydata")

  // let's build an index on our gridfs chunks collection if none
  gridFS.ensureIndex()

  def asyncLoadBlock(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, block: Point3D): Future[Iterable[Promise[Iteratee[_, Array[Byte]]]]] = {
    GridDataSetPairing.findPrefix(dataSet, dataLayer, resolution).flatMap(s =>
      Future.sequence(s.map { prefix =>
        val r = gridFS.find(BSONDocument(
          "_id" -> new BSONObjectID(GridDataStore.point3DToId(prefix, block)))).toList
        val arrayBuffer = new ArrayBuffer[Byte](128 * 128 * 128)
        val it = Iteratee.consume[Array[Byte]]()

        val f = r.map {
          case file :: _ =>
            val e = file.enumerate
            e.apply(it)
          case _ =>
            throw new DataNotFoundException
        }
        f
      }.seq))
  }

  def loadBlock(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, block: Point3D): Promise[DataBlock] = {
    val blockInfo = DataBlockInformation(dataSet.id, dataLayer, resolution, block)
    asyncLoadBlock(dataSet, dataLayer, resolution, block).map { iter =>
      val y = iter match {
        case head :: _ =>
          head.flatMap(_.mapDone { rawData =>
            val data = Data(rawData)
            val blockInfo = DataBlockInformation(dataSet.id, dataLayer, resolution, block)
            DataBlock(blockInfo, data)
          }.run)
        case _ =>
          throw new DataNotFoundException
      }
      y
    }.flatMap(x => x)
  }
}

object GridDataStore {
  def point3DToId(prefix: Int, point: Point3D): String = {
    "%012d%04d%04d%04d".format(prefix, point.x, point.y, point.z)
  }
}