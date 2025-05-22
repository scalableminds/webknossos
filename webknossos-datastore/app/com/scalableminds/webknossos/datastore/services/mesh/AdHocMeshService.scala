package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceMappingRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services.mcubes.MarchingCubes
import com.scalableminds.webknossos.datastore.services.{BinaryDataService, MappingService}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Failure, Full}
import org.apache.pekko.actor.{Actor, ActorRef, ActorSystem, Props}
import org.apache.pekko.pattern.ask
import org.apache.pekko.routing.RoundRobinPool
import org.apache.pekko.util.Timeout

import java.nio._
import scala.collection.mutable
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext}
import scala.reflect.ClassTag

case class AdHocMeshRequest(dataSourceId: Option[DataSourceId],
                            dataLayer: SegmentationLayer,
                            cuboid: Cuboid,
                            segmentId: Long,
                            voxelSizeFactor: Vec3Double, // assumed to be in dataset’s unit
                            tokenContext: TokenContext,
                            mapping: Option[String] = None,
                            mappingType: Option[String] = None,
                            additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
                            findNeighbors: Boolean = true)

case class DataTypeFunctors[T, B](
    getTypedBufferFn: ByteBuffer => B,
    copyDataFn: (B, Array[T]) => Unit,
    fromLong: Long => T
)

class AdHocMeshActor(val service: AdHocMeshService, val timeout: FiniteDuration) extends Actor {

  def receive: Receive = {
    case request: AdHocMeshRequest =>
      sender() ! Await.result(service.requestAdHocMesh(request)(request.tokenContext).futureBox, timeout)
    case _ =>
      sender() ! Failure("Unexpected message sent to AdHocMeshActor.")
  }
}

class AdHocMeshService(binaryDataService: BinaryDataService,
                       mappingService: MappingService,
                       actorSystem: ActorSystem,
                       adHocMeshTimeout: FiniteDuration,
                       adHocMeshActorPoolSize: Int)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  implicit val timeout: Timeout = Timeout(adHocMeshTimeout)

  private val actor: ActorRef =
    actorSystem.actorOf(RoundRobinPool(adHocMeshActorPoolSize).props(Props(new AdHocMeshActor(this, timeout.duration))))

  def requestAdHocMeshViaActor(request: AdHocMeshRequest): Fox[(Array[Float], List[Int])] =
    Fox.fromFutureBox {
      actor.ask(request).mapTo[Box[(Array[Float], List[Int])]].recover {
        case e: Exception => Failure(e.getMessage)
      }
    }

  def requestAdHocMesh(request: AdHocMeshRequest)(implicit tc: TokenContext): Fox[(Array[Float], List[Int])] =
    request.dataLayer.elementClass match {
      case ElementClass.uint8 | ElementClass.int8 =>
        generateAdHocMeshImpl[Byte, ByteBuffer](request,
                                                DataTypeFunctors[Byte, ByteBuffer](identity, _.get(_), _.toByte))

      case ElementClass.uint16 | ElementClass.int16 =>
        generateAdHocMeshImpl[Short, ShortBuffer](
          request,
          DataTypeFunctors[Short, ShortBuffer](_.asShortBuffer, _.get(_), _.toShort))

      case ElementClass.uint32 | ElementClass.int32 =>
        generateAdHocMeshImpl[Int, IntBuffer](request,
                                              DataTypeFunctors[Int, IntBuffer](_.asIntBuffer, _.get(_), _.toInt))
      case ElementClass.uint64 | ElementClass.int64 =>
        generateAdHocMeshImpl[Long, LongBuffer](request,
                                                DataTypeFunctors[Long, LongBuffer](_.asLongBuffer, _.get(_), identity))
    }

  private def generateAdHocMeshImpl[T: ClassTag, B <: Buffer](
      request: AdHocMeshRequest,
      dataTypeFunctors: DataTypeFunctors[T, B])(implicit tc: TokenContext): Fox[(Array[Float], List[Int])] = {

    def applyMapping(data: Array[T]): Fox[Array[T]] =
      request.mapping match {
        case Some(mappingName) =>
          request.mappingType match {
            case Some("JSON") =>
              mappingService.applyMapping(
                DataServiceMappingRequest(request.dataSourceId, request.dataLayer, mappingName),
                data,
                dataTypeFunctors.fromLong)
            case _ => Fox.successful(data)
          }
        case _ =>
          Fox.successful(data)
      }

    def applyAgglomerate(data: Array[Byte]): Fox[Array[Byte]] =
      request.mapping match {
        case Some(_) =>
          request.mappingType match {
            case Some("HDF5") =>
              binaryDataService.agglomerateServiceOpt.map { agglomerateService =>
                val dataRequest = DataServiceDataRequest(
                  request.dataSourceId,
                  request.dataLayer,
                  request.cuboid,
                  DataServiceRequestSettings(halfByte = false, request.mapping, None)
                )
                agglomerateService.applyAgglomerate(dataRequest)(data)
              }.getOrElse(Fox.successful(data))
            case _ =>
              Fox.successful(data)
          }
        case _ =>
          Fox.successful(data)
      }

    def convertData(data: Array[Byte]): Array[T] = {
      val srcBuffer = dataTypeFunctors.getTypedBufferFn(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN))
      srcBuffer.rewind()
      val dstArray = Array.ofDim[T](srcBuffer.remaining())
      dataTypeFunctors.copyDataFn(srcBuffer, dstArray)
      dstArray
    }

    def subVolumeContainsSegmentId[T](
        data: Array[T],
        dataDimensions: Vec3Int,
        boundingBox: BoundingBox,
        segmentId: T
    ): Boolean =
      boundingBox.topLeft.x until boundingBox.bottomRight.x exists { x =>
        boundingBox.topLeft.y until boundingBox.bottomRight.y exists { y =>
          boundingBox.topLeft.z until boundingBox.bottomRight.z exists { z =>
            val voxelOffset = x + y * dataDimensions.x + z * dataDimensions.x * dataDimensions.y
            data(voxelOffset) == segmentId
          }
        }
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

    val dataRequest = DataServiceDataRequest(
      request.dataSourceId,
      request.dataLayer,
      cuboid,
      DataServiceRequestSettings.default.copy(additionalCoordinates = request.additionalCoordinates)
    )

    val dataDimensions = Vec3Int(cuboid.width, cuboid.height, cuboid.depth)

    val offset = Vec3Double(cuboid.topLeft.voxelXInMag, cuboid.topLeft.voxelYInMag, cuboid.topLeft.voxelZInMag)
    val scale = Vec3Double(cuboid.topLeft.mag) * request.voxelSizeFactor
    val typedSegmentId = dataTypeFunctors.fromLong(request.segmentId)

    val vertexBuffer = mutable.ArrayBuffer[Vec3Double]()

    for {
      data <- binaryDataService.handleDataRequest(dataRequest)
      agglomerateMappedData <- applyAgglomerate(data) ?~> "failed to apply agglomerate for ad-hoc meshing"
      typedData = convertData(agglomerateMappedData)
      mappedData <- applyMapping(typedData)
      mappedSegmentId <- applyMapping(Array(typedSegmentId)).map(_.head)
      neighbors = if (request.findNeighbors) { findNeighbors(mappedData, dataDimensions, mappedSegmentId) } else {
        List()
      }

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
        if (subVolumeContainsSegmentId(mappedData, dataDimensions, boundingBox, mappedSegmentId)) {
          MarchingCubes
            .marchingCubes[T](mappedData, dataDimensions, boundingBox, mappedSegmentId, offset, scale, vertexBuffer)
        }
      }
      (vertexBuffer.flatMap(_.toList.map(_.toFloat)).toArray, neighbors)
    }
  }
}
