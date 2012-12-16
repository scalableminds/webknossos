package brainflight.binary

import brainflight.tools.geometry.Point3D
import models.binary._
import brainflight.tools.geometry.Vector3D
import play.api.Play
import brainflight.tools.Math._
import scala.collection.mutable.ArrayBuffer

/**
 * Abstract Datastore defines all method a binary data source (e.q. normal file
 * system or db implementation) must implement to be used
 */
case class DataRequest(
  dataSet: DataSet, 
  layer: DataLayer, 
  resolution: Int,
  cuboid: Cuboid,
  useHalfByte: Boolean = false
)
abstract class DataStore {
  
  val conf = Play.current.configuration
  
  val blockLength = conf.getInt("binary.blockLength") getOrElse 128
  
  val blockSize = blockLength * blockLength * blockLength
  
  /**
   * Loads the data of a given point from the data source
   */
  def load(dataRequest: DataRequest): ArrayBuffer[Byte]

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
  def createFilename(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, point: Point3D) =
    "%s/%s/%d/x%04d/y%04d/z%04d/%s_mag%d_x%04d_y%04d_z%04d.raw".format(
      dataSet.baseDir,
      dataLayer.folder,
      resolution,
      point.x, point.y, point.z,
      dataSet.name,
      resolution,
      point.x, point.y, point.z)

  def createNullArray(blockSize: Int, bytesPerElement: Int) =
    new Array[Byte](blockSize * bytesPerElement)

  def nullValue(bytesPerElement: Int) =
    new Array[Byte](bytesPerElement).toBuffer.asInstanceOf[ArrayBuffer[Byte]]
    
    lazy val nullArray: Array[Array[Byte]] = 
    Array(1,2,4,8).map(bytesPerElement => createNullArray(blockSize, bytesPerElement))
    
  def nullBlock(bytesPerElement: Int) = 
    nullArray(log2(bytesPerElement).toInt)  
    
  val elementsPerFile = 128 * 128 * 128
}