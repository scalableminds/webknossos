package brainflight.binary

import brainflight.tools.geometry.Point3D
import play.api.libs.concurrent.Promise
import play.api.libs.concurrent.execution.defaultContext
import models.binary._
import brainflight.tools.geometry.Vector3D
import play.api.Play
import brainflight.tools.Math._
import scala.collection.mutable.ArrayBuffer
import akka.actor.Actor
import play.api.Logger
import akka.agent.Agent
import akka.util.Timeout
import akka.util.duration._
import akka.pattern.pipe
import akka.actor.Status
import java.util.concurrent.TimeoutException

/**
 * Abstract Datastore defines all method a binary data source (e.q. normal file
 * system or db implementation) must implement to be used
 */
case class DataRequest(
  dataSet: DataSet,
  layer: DataLayer,
  resolution: Int,
  cuboid: Cuboid,
  useHalfByte: Boolean = false)

case class LoadBlock(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, block: Point3D)

class DataNotFoundException(message: String) extends Exception(message + " Could not find the data")

abstract class DataStore extends Actor {
  import DataStore._

  val MAX_RESOLUTION_EXPONENT = 9
  val MAX_BYTES_PER_ELEMENT = 8

  val loading = Agent(Map[LoadBlock, Promise[Array[Byte]]]())(context.system)

  /**
   * Loads the data of a given point from the data source
   */
  def load(dataInfo: LoadBlock): Promise[Array[Byte]]

  def receive = {
    case request @ LoadBlock(dataSet, dataLayer, resolution, block) =>
      if (resolution > MAX_RESOLUTION_EXPONENT)
        sender ! new IndexOutOfBoundsException("Resolution not supported")
      else {
        val s = sender
        loading.future(50 milliseconds).recover {
          case e: TimeoutException =>
            Map[LoadBlock, Promise[Array[Byte]]]()
        }.map { loadingCache =>
          val promise = loadingCache.get(request).getOrElse {
            val p = load(request)
            loading send (_ + (request -> p))
            p
          }
          promise.onComplete {
            case Right(a) =>
              s ! a
              loading send (_ - request)
            case Left(e) =>
              Logger.warn(block + " DataStore couldn't load block: " + e)
              s ! e
              loading send (_ - request)
          }
        }
      }
  }

  /**
   * Gives the data store the possibility to clean up its mess on shutdown/clean
   */
  def cleanUp()

  /**
   * Creates the file-name of the cube based on the data set id, resolution
   * and coordinates.
   *
   * Example:
   *  "binaryData/100527_k0563/1/x0001/y0002/z0004/100527_k0563_mag1_x0001_y0002_z0004.raw"
   *
   * The path structure is:
   *  "DATAPATH/DATASETID/RESOLUTION/.../DATASETID_magRESOLUTION_xX_yY_zZ.raw"
   *
   *  where DATAPATH, DATASETID, RESOLUTION, X, Y and Z are parameters.
   */

  def createNullArray(blockSize: Int, bytesPerElement: Int) =
    new Array[Byte](blockSize * bytesPerElement)

  lazy val nullBlocks: Array[Array[Byte]] =
    (0 to MAX_RESOLUTION_EXPONENT).toArray.map { exp =>
      val bytesPerElement = math.pow(2, exp).toInt
      createNullArray(blockSize, bytesPerElement)
    }

  def nullBlock(bytesPerElement: Int) =
    nullBlocks(log2(bytesPerElement).toInt)

  val elementsPerFile = 128 * 128 * 128
  
  lazy val nullFiles: Stream[Array[Byte]] = 
    (1 to MAX_BYTES_PER_ELEMENT).toStream.map { bytesPerElement =>
      new Array[Byte](elementsPerFile * bytesPerElement)
  }
  
  def nullFile(bytesPerElement: Int) = nullFiles(bytesPerElement)
}

object DataStore {

  val blockLength = Play.current.configuration.getInt("binary.blockLength") getOrElse 128

  val blockSize = blockLength * blockLength * blockLength

  def createFilename(dataInfo: LoadBlock) =
    "%s/%s/%d/x%04d/y%04d/z%04d/%s_mag%d_x%04d_y%04d_z%04d.raw".format(
      dataInfo.dataSet.baseDir,
      dataInfo.dataLayer.folder,
      dataInfo.resolution,
      dataInfo.block.x, dataInfo.block.y, dataInfo.block.z,
      dataInfo.dataSet.name,
      dataInfo.resolution,
      dataInfo.block.x, dataInfo.block.y, dataInfo.block.z)
}