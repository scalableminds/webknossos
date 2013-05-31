package braingames.binary.store

import java.io.{ FileNotFoundException, InputStream, FileInputStream }
import scala.collection.JavaConverters._
import akka.agent.Agent
import scala.io.Codec.charset2codec
import reactivemongo.api._
import reactivemongo.api.gridfs._
import reactivemongo.bson.BSONDocument
import reactivemongo.bson.BSONObjectID
import reactivemongo.bson._
import reactivemongo.api.gridfs.Implicits._
import play.api.libs.iteratee._
import scala.collection.mutable.ArrayBuffer
import java.io.File
import scala.concurrent.Future
import scala.concurrent.Promise
import scala.concurrent.ExecutionContext.Implicits._
import akka.actor.Actor
import braingames.binary.models.DataSet
import reactivemongo.api.MongoConnection
import braingames.binary.LoadBlock
import net.liftweb.common.Box

case class InsertBinary(dataSet: DataSet)
case class InsertionState()
/*
class BinaryData2DBActor extends Actor {
  lazy val insertionState = Agent[Map[DataSetLike, (Int, Int)]](Map())(context.system)

  //GridFs handle
  lazy val connection = MongoConnection(List("localhost:27017"))
  // a GridFS store named 'attachments'

  val gridFS = new GridFS(DB("binaryData", connection), "binarydata")

  def receive = {
    case InsertBinary(dataSet) =>
      Future {
        create(dataSet)
      }
    case InsertionState() =>
      val state = insertionState()
      sender ! state.mapValues(i => i._1 / i._2.toDouble)
  }

  def create(dataSet: DataSetLike) = {
    val resolution = 1
    val dataLayer = dataSet.colorLayer
    GridDataSetPairing.getOrCreatePrefix(dataSet, dataLayer, 1).map { prefix =>
      val max = dataSet.maxCoordinates
      val maxX = ((max.x / 128.0).ceil - 1).toInt
      val maxY = ((max.y / 128.0).ceil - 1).toInt
      val maxZ = ((max.z / 128.0).ceil - 1).toInt

      val maxAll = maxX * maxY * maxZ
      for {
        x <- 0 to maxX
        y <- 0 to maxY
        z <- 0 to maxZ
      } {
        val blockInfo = LoadBlock(dataSet.baseDir, dataSet.name, dataLayer.baseDir, dataLayer.bytesPerElement, resolution, x, y, z)
        val f = new File(DataStore.createFilename(blockInfo))
        val blockId = GridDataStore.blockToId(prefix, x, y, z)
        val meta = DefaultFileToSave(blockId, id = new BSONObjectID(blockId))
        val enumerator = Enumerator.fromFile(f)
        val it = gridFS.save(enumerator, meta, 2359296)
        it.map(result =>
          insertionState send { d =>
            val p = d.get(dataSet) getOrElse (0 -> 0)
            d.updated(dataSet, (p._1 + 1 -> maxAll))
          })
      }
    }
  }
}
*/
class GridDataStore
    extends DataStore {
  import DataStore._
  //GridFs handle
  lazy val driver = new MongoDriver
  lazy val connection = driver.connection(List("localhost:27017"))
  // a GridFS store named 'attachments'

  val gridFS = new GridFS(DB("binaryData", connection), "binarydata")

  // let's build an index on our gridfs chunks collection if none
  gridFS.ensureIndex()

  def load(blockInfo: LoadBlock): Future[Box[Array[Byte]]] = {
    /*GridDataSetPairing.findPrefix(blockInfo.dataSetName, blockInfo.dataLayerBaseDir, blockInfo.resolution).flatMap {
      _ match {
        case Some(prefix) =>
          val r = gridFS.find(BSONDocument(
            "_id" -> new BSONObjectID(GridDataStore.blockToId(prefix, blockInfo.x, blockInfo.y, blockInfo.z)))).headOption
          val it = Iteratee.consume[Array[Byte]]()

         r.flatMap(_ match {
            case Some(file) =>
              val e = gridFS.enumerate(file)
              e.run(it)
            case _ =>
              Future.failed(new DataNotFoundException("GRIDFS1"))
          })
        case _ =>
          Future.failed(new DataNotFoundException("GRIDFS2"))
      }
    }
    * 
    */
    
    //Future.failed(new DataNotFoundException("GRIDFS2"))
    Future.successful(None)
  }
}

object GridDataStore {
  def blockToId(prefix: Long, x: Int, y: Int, z: Int): String = {
    "%012d%04d%04d%04d".format(prefix, x, y, z)
  }
}