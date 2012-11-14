package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream }
import scala.collection.JavaConverters._
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D
import models.binary.DataSet
import brainflight.tools.geometry.Cuboid
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

class GridDataStore(cacheAgent: Agent[Map[DataBlockInformation, Data]])
    extends CachedDataStore(cacheAgent) {
  //GridFs handle
  lazy val connection = MongoConnection(List("localhost:27017"))
  // a GridFS store named 'attachments'

  val gridFS = new BinaryDataFS(DB("binaryData", connection), "binarydata")

  // let's build an index on our gridfs chunks collection if none
  gridFS.ensureIndex()

  def asyncLoadBlock(dataSet: DataSet, point: Point3D, resolution: Int): Future[Iterable[Promise[Iteratee[_, Array[Byte]]]]] = {
    GridDataSetPairing.findPrefix(dataSet).flatMap(s =>
      Future.sequence(s.map { prefix =>
        val r = gridFS.find(BSONDocument("_id" -> new BSONObjectID(point3DToId(prefix, point)))).toList
        val arrayBuffer = new ArrayBuffer[Byte](128 * 128 * 128)
        val it = Iteratee.consume[Array[Byte]]()

        val f = r.map {
          case file :: _ =>
            val e = file.enumerate
            e.apply(it)
          case _ =>
            throw new Exception("Couldn't find " + point)
        }
        f
      }.seq))
  }

  def loadBlock(dataSet: DataSet, point: Point3D, resolution: Int): Promise[DataBlock] = {
    val blockInfo = DataBlockInformation(dataSet.id, point, resolution)
    asyncLoadBlock(dataSet, point, resolution).map { iter =>

      val y = iter match {
        case head :: _ =>
          head.flatMap(_.mapDone { rawData =>
            val data = Data(rawData)
            val blockInfo = DataBlockInformation(dataSet.id, point, resolution)
            DataBlock(blockInfo, data)
          }.run)
        case _ =>
          Akka.future(DataBlock(blockInfo, Data(nullBlock)))
      }
      y
    }.flatMap(x => x)
  }

  def point3DToId(prefix: Int, point: Point3D): String = {
    "%012d%04d%04d%04d".format(prefix, point.x, point.y, point.z)
  }

  def create(dataSet: DataSet, resolution: Int) = {
    GridDataSetPairing.getOrCreatePrefix(dataSet).map { prefix =>
      val max = dataSet.maxCoordinates
      val maxX = ((max.x / 128.0).ceil - 1).toInt
      val maxY = ((max.y / 128.0).ceil - 1).toInt
      val maxZ = ((max.z / 128.0).ceil - 1).toInt

      for {
        x <- 0 to maxX
        y <- 0 to maxY
        z <- 0 to maxZ
      } {
        val point = Point3D(x, y, z)
        val f = new File(createFilename(dataSet, resolution, point))
        val pointId = point3DToId(prefix, point)
        val it = gridFS.save(pointId, Some(new BSONObjectID(pointId)), Some("application/binary"))
        Enumerator.fromFile(f)(it).map(_.mapDone { future =>
          future.map(result => println("PutResult: " + result))
        })
      }
    }
  }
}