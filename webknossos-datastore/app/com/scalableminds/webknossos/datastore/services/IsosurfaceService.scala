package com.scalableminds.webknossos.datastore.services

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.ask
import akka.routing.RoundRobinPool
import akka.util.Timeout
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D, Vector3I}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceMappingRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes
import net.liftweb.common.{Box, Failure}

import java.nio._
import scala.collection.mutable
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.reflect.ClassTag

case class IsosurfaceRequest(
    dataSource: Option[DataSource],
    dataLayer: SegmentationLayer,
    cuboid: Cuboid,
    segmentId: Long,
    voxelDimensions: Vector3I,
    scale: Vector3D,
    mapping: Option[String] = None,
    mappingType: Option[String] = None
)

case class DataTypeFunctors[T, B](
    getTypedBufferFn: ByteBuffer => B,
    copyDataFn: (B, Array[T]) => Unit,
    fromLong: Long => T
)

class IsosurfaceActor(val service: IsosurfaceService, val timeout: FiniteDuration) extends Actor {

  def receive = {
    case request: IsosurfaceRequest =>
      sender() ! Await.result(service.requestIsosurface(request).futureBox, timeout)
    case _ =>
      sender ! Failure("Unexpected message sent to IsosurfaceActor.")
  }
}

class IsosurfaceService(binaryDataService: BinaryDataService,
                        mappingService: MappingService,
                        actorSystem: ActorSystem,
                        isosurfaceTimeout: FiniteDuration,
                        isosurfaceActorPoolSize: Int)(implicit ec: ExecutionContext)
    extends FoxImplicits {

  val agglomerateService: AgglomerateService = binaryDataService.agglomerateService

  implicit val timeout: Timeout = Timeout(isosurfaceTimeout)

  val actor = actorSystem.actorOf(
    RoundRobinPool(isosurfaceActorPoolSize).props(Props(new IsosurfaceActor(this, timeout.duration))))

  def requestIsosurfaceViaActor(request: IsosurfaceRequest): Fox[(Array[Float], List[Int])] =
    actor.ask(request).mapTo[Box[(Array[Float], List[Int])]].recover {
      case e: Exception => Failure(e.getMessage)
    }

  def requestIsosurface(request: IsosurfaceRequest): Fox[(Array[Float], List[Int])] =
    request.dataLayer.elementClass match {
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
      request: IsosurfaceRequest,
      dataTypeFunctors: DataTypeFunctors[T, B]): Fox[(Array[Float], List[Int])] = {

    def applyMapping(data: Array[T]): Fox[Array[T]] =
      request.mapping match {
        case Some(mappingName) =>
          request.mappingType match {
            case Some("JSON") =>
              mappingService.applyMapping(
                DataServiceMappingRequest(request.dataSource.orNull, request.dataLayer, mappingName),
                data,
                dataTypeFunctors.fromLong)
            case _ => Fox.successful(data)
          }
        case _ =>
          Fox.successful(data)
      }

    def applyAgglomerate(data: Array[Byte]): Array[Byte] =
      request.mapping match {
        case Some(_) =>
          request.mappingType match {
            case Some("HDF5") =>
              val dataRequest = DataServiceDataRequest(
                request.dataSource.orNull,
                request.dataLayer,
                request.mapping,
                request.cuboid,
                DataServiceRequestSettings(halfByte = false, request.mapping, None),
                Vector3I(1, 1, 1)
              )
              agglomerateService.applyAgglomerate(dataRequest)(data)
            case _ =>
              data
          }
        case _ =>
          data
      }

    def convertData(data: Array[Byte]): Array[T] = {
      val srcBuffer = dataTypeFunctors.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
      srcBuffer.rewind()
      val dstArray = Array.ofDim[T](srcBuffer.remaining())
      dataTypeFunctors.copyDataFn(srcBuffer, dstArray)
      dstArray
    }

    def subVolumeContainsSegmentId[T](data: Array[T],
                                      dataDimensions: Vector3I,
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

    def findNeighbors[T](data: Array[T], dataDimensions: Vector3I, segmentId: T): List[Int] = {
      val x = dataDimensions.x - 1
      val y = dataDimensions.y - 1
      val z = dataDimensions.z - 1
      val front_xy = BoundingBox(Point3D(0, 0, 0), x, y, 1)
      val front_xz = BoundingBox(Point3D(0, 0, 0), 1, y, z)
      val front_yz = BoundingBox(Point3D(0, 0, 0), x, 1, z)
      val back_xy = BoundingBox(Point3D(0, 0, z), x, y, 1)
      val back_xz = BoundingBox(Point3D(0, y, 0), 1, y, z)
      val back_yz = BoundingBox(Point3D(x, 0, 0), x, 1, z)
      val surfaceBoundingBoxes = List(front_xy, front_xz, front_yz, back_xy, back_xz, back_yz)
      surfaceBoundingBoxes.zipWithIndex.filter {
        case (surfaceBoundingBox, index) =>
          subVolumeContainsSegmentId(data, dataDimensions, surfaceBoundingBox, segmentId)
      }.map {
        case (surfaceBoundingBox, index) => index
      }
    }

    val cuboid = request.cuboid
    val voxelDimensions = Vector3D(request.voxelDimensions.x, request.voxelDimensions.y, request.voxelDimensions.z)

    val dataRequest = DataServiceDataRequest(request.dataSource.orNull,
                                             request.dataLayer,
                                             request.mapping,
                                             cuboid,
                                             DataServiceRequestSettings.default,
                                             request.voxelDimensions)

    val dataDimensions = Vector3I(math.ceil(cuboid.width / voxelDimensions.x).toInt,
                                  math.ceil(cuboid.height / voxelDimensions.y).toInt,
                                  math.ceil(cuboid.depth / voxelDimensions.z).toInt)

    val offset = Vector3D(cuboid.topLeft.x, cuboid.topLeft.y, cuboid.topLeft.z)
    val scale = Vector3D(cuboid.topLeft.resolution) * request.scale
    val typedSegmentId = dataTypeFunctors.fromLong(request.segmentId)

    val vertexBuffer = mutable.ArrayBuffer[Vector3D]()

    for {
      data <- binaryDataService.handleDataRequest(dataRequest)
      agglomerateMappedData = applyAgglomerate(data)
      typedData = convertData(agglomerateMappedData)
      mappedData <- applyMapping(typedData)
      mappedSegmentId <- applyMapping(Array(typedSegmentId)).map(_.head)
      neighbors = findNeighbors(mappedData, dataDimensions, mappedSegmentId)
    } yield {
      for {
        x <- 0 until dataDimensions.x by 32
        y <- 0 until dataDimensions.y by 32
        z <- 0 until dataDimensions.z by 32
      } {
        val boundingBox = BoundingBox(Point3D(x, y, z),
                                      math.min(dataDimensions.x - x, 33),
                                      math.min(dataDimensions.y - y, 33),
                                      math.min(dataDimensions.z - z, 33))
        if (subVolumeContainsSegmentId(mappedData, dataDimensions, boundingBox, mappedSegmentId)) {
          MarchingCubes.marchingCubes[T](mappedData,
                                         dataDimensions,
                                         boundingBox,
                                         mappedSegmentId,
                                         voxelDimensions,
                                         offset,
                                         scale,
                                         vertexBuffer)
        }
      }
      (vertexBuffer.flatMap(_.toList.map(_.toFloat)).toArray, neighbors)
    }
  }
}
