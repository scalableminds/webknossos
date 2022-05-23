/*
package com.scalableminds.webknossos.tracingstore.tracings.editablemapping

import java.nio.{Buffer, ByteBuffer, ByteOrder, IntBuffer, LongBuffer, ShortBuffer}

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.WebKnossosIsosurfaceRequest
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{Cuboid, DataServiceDataRequest, DataServiceMappingRequest, DataServiceRequestSettings}
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes
import com.scalableminds.webknossos.datastore.services.{DataTypeFunctors, IsosurfaceRequest}
import javax.inject.Inject

import scala.collection.mutable
import scala.reflect.ClassTag

case class EditableMappingIsosurfaceRequest(
  tracing: VolumeTracing,
                              cuboid: Cuboid,
                              segmentId: Long,
                              subsamplingStrides: Vec3Int,
                              scale: Vec3Double,
                              mapping: Option[String] = None,
                              mappingType: Option[String] = None
                            )

class EditableMappingsIsosurfaceService @Inject()(editableMappingService: EditableMappingService) extends ProtoGeometryImplicits {
  def createIsosurface(tracing: VolumeTracing, request: WebKnossosIsosurfaceRequest): Fox[(Array[Float], List[Int])] = {
    requestIsosurface(EditableMappingIsosurfaceRequest())
  }

  def requestIsosurface(request: EditableMappingIsosurfaceRequest): Fox[(Array[Float], List[Int])] =
    elementClassFromProto(request.tracing.elementClass) match {
      case ElementClass.uint8 =>
        generateIsosurfaceImpl[Byte, ByteBuffer](request,
          DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))
      case ElementClass.uint16 =>
        generateIsosurfaceImpl[Short, ShortBuffer](
          request,
          DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))
      case ElementClass.uint32 =>
        generateIsosurfaceImpl[Int, IntBuffer](request,
          DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
      case ElementClass.uint64 =>
        generateIsosurfaceImpl[Long, LongBuffer](request,
          DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
    }

  private def generateIsosurfaceImpl[T: ClassTag, B <: Buffer](
                                                                request: EditableMappingIsosurfaceRequest,
                                                                dataTypeFunctors: DataTypeFunctors[T, B]): Fox[(Array[Float], List[Int])] = {

    def convertData(data: Array[Byte]): Array[T] = {
      val srcBuffer = dataTypeFunctors.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
      srcBuffer.rewind()
      val dstArray = Array.ofDim[T](srcBuffer.remaining())
      dataTypeFunctors.copyDataFn(srcBuffer, dstArray)
      dstArray
    }

    def subVolumeContainsSegmentId[T](data: Array[T],
                                      dataDimensions: Vec3Int,
                                      boundingBox: BoundingBox,
                                      segmentId: T): Boolean = {
      for {
        x <- boundingBox.topLeft.x until boundingBox.bottomRight.x
        y <- boundingBox.topLeft.y until boundingBox.bottomRight.y
        z <- boundingBox.topLeft.z until boundingBox.bottomRight.z
      } {
        val voxelOffset = x + y * dataDimensions.x + z * dataDimensions.x * dataDimensions.y
        if (data(voxelOffset) == segmentId) return true
      }
      false
    }

    def findNeighbors[T](data: Array[T], dataDimensions: Vec3Int, segmentId: T): List[Int] = {
      val x = dataDimensions.x - 1
      val y = dataDimensions.y - 1
      val z = dataDimensions.z - 1
      val front_xy = BoundingBox(Vec3Int(0, 0, 0), x, y, 1)
      val front_xz = BoundingBox(Vec3Int(0, 0, 0), x, 1, z)
      val front_yz = BoundingBox(Vec3Int(0, 0, 0), 1, y, z)
      val back_xy = BoundingBox(Vec3Int(0, 0, z), x, y, 1)
      val back_xz = BoundingBox(Vec3Int(0, y, 0), x, 1, z)
      val back_yz = BoundingBox(Vec3Int(x, 0, 0), 1, y, z)
      val surfaceBoundingBoxes = List(front_xy, front_xz, front_yz, back_xy, back_xz, back_yz)
      surfaceBoundingBoxes.zipWithIndex.filter {
        case (surfaceBoundingBox, index) =>
          subVolumeContainsSegmentId(data, dataDimensions, surfaceBoundingBox, segmentId)
      }.map {
        case (surfaceBoundingBox, index) => index
      }
    }

    val cuboid = request.cuboid
    val subsamplingStrides =
      Vec3Double(request.subsamplingStrides.x, request.subsamplingStrides.y, request.subsamplingStrides.z)

    val dataRequest = DataServiceDataRequest(request.dataSource.orNull,
      request.dataLayer,
      request.mapping,
      cuboid,
      DataServiceRequestSettings.default,
      request.subsamplingStrides)

    val dataDimensions = Vec3Int(
      math.ceil(cuboid.width / subsamplingStrides.x).toInt,
      math.ceil(cuboid.height / subsamplingStrides.y).toInt,
      math.ceil(cuboid.depth / subsamplingStrides.z).toInt
    )

    val offset = Vec3Double(cuboid.topLeft.x, cuboid.topLeft.y, cuboid.topLeft.z)
    val scale = Vec3Double(cuboid.topLeft.mag) * request.scale
    val typedSegmentId = dataTypeFunctors.fromLong(request.segmentId)

    val vertexBuffer = mutable.ArrayBuffer[Vec3Double]()

    for {
      data <- binaryDataService.handleDataRequest(dataRequest)
      typedData = convertData(data)
      neighbors = findNeighbors(typedData, dataDimensions, typedSegmentId)
    } yield {
      for {
        x <- 0 until dataDimensions.x by 32
        y <- 0 until dataDimensions.y by 32
        z <- 0 until dataDimensions.z by 32
      } {
        val boundingBox = BoundingBox(Vec3Int(x, y, z),
          math.min(dataDimensions.x - x, 33),
          math.min(dataDimensions.y - y, 33),
          math.min(dataDimensions.z - z, 33))
        if (subVolumeContainsSegmentId(typedData, dataDimensions, boundingBox, typedSegmentId)) {
          MarchingCubes.marchingCubes[T](typedData,
            dataDimensions,
            boundingBox,
            typedSegmentId,
            subsamplingStrides,
            offset,
            scale,
            vertexBuffer)
        }
      }
      (vertexBuffer.flatMap(_.toList.map(_.toFloat)).toArray, neighbors)
    }
  }

}
 */
