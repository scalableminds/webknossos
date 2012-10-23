package brainflight.binary

import play.Logger
import java.io.{ FileNotFoundException, InputStream, FileInputStream }
import scala.collection.JavaConverters._
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D
import models.DataSet
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

class GridDataStore(cacheAgent: Agent[Map[DataBlockInformation, Data]])
    extends CachedDataStore(cacheAgent) {
  //GridFs handle
  lazy val connection = MongoConnection(List("localhost:27017"))
  // a GridFS store named 'attachments'

  val gridFS = new BinaryDataFS(DB("play-shellgame", connection), "binarydata")

  // let's build an index on our gridfs chunks collection if none
  gridFS.ensureIndex()

  def asyncLoadBlock(dataSet: DataSet, point: Point3D, resolution: Int): Future[Promise[Iteratee[_, Array[Byte]]]] = {
    val r = gridFS.find(BSONDocument("_id" -> new BSONObjectID(point3DToId(point)))).toList
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
  }

  def loadBlock(dataSet: DataSet, point: Point3D, resolution: Int): Promise[DataBlock] = {
    val future = asyncLoadBlock(dataSet, point, resolution)
    val result: Promise[Promise[DataBlock]] = for {
      promis <- future
      x <- promis
    } yield {
      x.mapDone { rawData =>
        val data = Data(rawData)
        val blockInfo = DataBlockInformation(dataSet.id, point, resolution)
        DataBlock(blockInfo, data)
      }.run
    }

    result.flatMap(x => x)
  }

  def point3DToId(point: Point3D): String = {
    "000000000000%04d%04d%04d".format(point.x, point.y, point.z)
  }

  def create(dataSet: DataSet, resolution: Int) = {
    (0 to 1000) foreach { idx =>
      val point = Point3D(idx / 88, (idx / 8) % 11, idx % 8)
      val f = new File(createFilename(dataSet, resolution, point))
      val it = gridFS.save(point3DToId(point), Some(new BSONObjectID(point3DToId(point))), Some("application/binary"))
      Enumerator.fromFile(f)(it).map(_.mapDone { future =>
        future.map(result => println("PutResult: " + result))
      })
    }
  }
}