package com.scalableminds.webknossos.datastore.services

import java.io.File
import java.nio.{Buffer, ByteBuffer, ByteOrder, FloatBuffer, IntBuffer, LongBuffer, ShortBuffer}
import java.nio.file.Paths

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractDataLayerMapping,
  DataLayerMapping,
  ElementClass
}
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceMappingRequest, MappingReadInstruction}
import com.scalableminds.webknossos.datastore.storage.ParsedMappingCache
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import javax.swing.tree.DefaultMutableTreeNode
import spire.math.{UByte, UInt, ULong, UShort}

import scala.collection.mutable
import scala.concurrent.ExecutionContext.Implicits.global
import scala.reflect.ClassTag
//import hdf.`object`._
//import ncsa.hdf.hdf5lib.HDF5Constants
import ch.systemsx.cisd.hdf5._

class AgglomerateService @Inject()(config: DataStoreConfig) extends FoxImplicits with LazyLogging {
  lazy val cache = new ParsedMappingCache(config.Braingames.Binary.mappingCacheMaxSize)
  lazy val loadedAgglomerate =
    HDF5FactoryProvider.get
      .openForReading(new File(
        s"${config.Braingames.Binary.baseFolder}/sample_organization/test-agglomerate-file/segmentation/mappings/agglomerate_view_70.hdf5"))
      .uint8()
  val datasetName = "/segment_to_agglomerate"

  def loadAgglomerates(segmentIds: mutable.HashSet[Long]): mutable.HashMap[Long, Long] = {
    val result = mutable.HashMap[Long, Long]()
    segmentIds.foreach(id => result += (id -> loadedAgglomerate.readArrayBlock(datasetName, 1, id).toSeq.head.toLong))
    result
  }

  def convertData(data: Array[Byte],
                  elementClass: ElementClass.Value,
                  filterZeroes: Boolean = false): Array[_ >: UByte with UShort with UInt with ULong with Float] =
    elementClass match {
      case ElementClass.uint8 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
          .map(UByte(_))
          .filter(!filterZeroes || _ != UByte(0))
      case ElementClass.uint16 =>
        convertDataImpl[Short, ShortBuffer](data,
                                            DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
          .map(UShort(_))
          .filter(!filterZeroes || _ != UShort(0))
      case ElementClass.uint24 =>
        convertDataImpl[Byte, ByteBuffer](data, DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
          .map(UByte(_))
          .filter(!filterZeroes || _ != UByte(0))
      case ElementClass.uint32 =>
        convertDataImpl[Int, IntBuffer](data, DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
          .map(UInt(_))
          .filter(!filterZeroes || _ != UInt(0))
      case ElementClass.uint64 =>
        convertDataImpl[Long, LongBuffer](data, DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
          .map(ULong(_))
          .filter(!filterZeroes || _ != ULong(0))
      case ElementClass.float =>
        convertDataImpl[Float, FloatBuffer](
          data,
          DataTypeFunctors[Float, FloatBuffer](_.asFloatBuffer(), _.get(_), _.toFloat)).filter(!filterZeroes || _ != 0f)
    }

  private def convertDataImpl[T: ClassTag, B <: Buffer](data: Array[Byte],
                                                        dataTypeFunctor: DataTypeFunctors[T, B]): Array[T] = {
    val srcBuffer = dataTypeFunctor.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
    srcBuffer.rewind()
    val dstArray = Array.ofDim[T](srcBuffer.remaining())
    dataTypeFunctor.copyDataFn(srcBuffer, dstArray)
    dstArray
  }
}
