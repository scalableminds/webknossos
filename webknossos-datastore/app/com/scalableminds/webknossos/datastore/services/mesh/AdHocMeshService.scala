package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Failure}
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.geometry.{Vec3Double, Vec3Float, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, ElementClass, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceMappingRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services.BinaryDataService
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import org.apache.pekko.actor.{Actor, ActorRef, ActorSystem, Props}
import org.apache.pekko.pattern.ask
import org.apache.pekko.routing.RoundRobinPool
import org.apache.pekko.util.Timeout

import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.duration.*
import scala.concurrent.{Await, ExecutionContext}

case class AdHocMeshRequest(
    datasetId: Option[ObjectId],
    dataSourceId: Option[DataSourceId],
    dataLayer: SegmentationLayer,
    cuboid: Cuboid,
    segmentId: Long,
    voxelSizeFactor: Vec3Double, // assumed to be in dataset’s unit
    tokenContext: TokenContext,
    mapping: Option[String] = None,
    mappingType: Option[MappingType.Value] = None,
    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
    annotationVersion: Option[Long],
    findNeighbors: Boolean = true
)

class AdHocMeshActor(val service: AdHocMeshService, val timeout: FiniteDuration) extends Actor {

  def receive: Receive = {
    case request: AdHocMeshRequest =>
      sender() ! Await.result(service.requestAdHocMesh(request)(using request.tokenContext).futureBox, timeout)
    case _ =>
      sender() ! Failure("Unexpected message sent to AdHocMeshActor.")
  }

}

class AdHocMeshService(
    binaryDataService: BinaryDataService,
    mappingService: MappingService,
    actorSystem: ActorSystem,
    adHocMeshTimeout: FiniteDuration,
    adHocMeshActorPoolSize: Int
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  implicit private val timeout: Timeout = Timeout(adHocMeshTimeout)

  private val actor: ActorRef =
    actorSystem.actorOf(RoundRobinPool(adHocMeshActorPoolSize).props(Props(new AdHocMeshActor(this, timeout.duration))))

  def requestAdHocMeshViaActor(request: AdHocMeshRequest): Fox[(Array[Float], List[Int])] =
    Fox.fromFutureBox {
      actor.ask(request).mapTo[Box[(Array[Float], List[Int])]].recover { case e: Exception =>
        Failure(e.getMessage)
      }
    }

  private lazy val adHocMesher = new NativeAdHocMesher()

  def requestAdHocMesh(request: AdHocMeshRequest)(using tc: TokenContext): Fox[(Array[Float], List[Int])] = {
    val cuboid = request.cuboid
    val elementClass = request.dataLayer.elementClass

    val dataRequest = DataServiceDataRequest(
      request.datasetId,
      request.dataSourceId,
      request.dataLayer,
      cuboid,
      DataServiceRequestSettings(
        additionalCoordinates = request.additionalCoordinates,
        version = request.annotationVersion
      )
    )

    val dataDimensions = Vec3Int(cuboid.width, cuboid.height, cuboid.depth)

    val offset = Vec3Float(
      cuboid.topLeft.voxelXInMag.toFloat,
      cuboid.topLeft.voxelYInMag.toFloat,
      cuboid.topLeft.voxelZInMag.toFloat
    )
    val scale = Vec3Float(cuboid.topLeft.mag) * Vec3Float(request.voxelSizeFactor)

    for {
      _ <- Fox.fromBool(ElementClass.segmentationElementClasses.contains(elementClass)) ?~>
        s"Ad-hoc meshing is not supported for element class $elementClass"
      data <- binaryDataService.handleDataRequest(dataRequest)
      agglomerateMappedData <- applyAgglomerate(request, data) ?~> "failed to apply agglomerate for ad-hoc meshing"
      (mappedData, mappedSegmentId) <- applyJsonMappingIfNeeded(request, agglomerateMappedData)
      (vertices, neighbors) <- tryo(
        adHocMesher.mesh(
          mappedData,
          ElementClass.bytesPerElement(elementClass),
          dataDimensions,
          mappedSegmentId,
          offset,
          scale
        )
      ).toFox
    } yield (vertices, if (request.findNeighbors) neighbors else List())
  }

  private def applyAgglomerate(request: AdHocMeshRequest, data: Array[Byte])(using
      tc: TokenContext
  ): Fox[Array[Byte]] =
    request.mappingType match {
      case Some(MappingType.AGGLOMERATE) if request.mapping.isDefined =>
        binaryDataService.agglomerateServiceOpt.map { agglomerateService =>
          val dataRequest = DataServiceDataRequest(
            request.datasetId,
            request.dataSourceId,
            request.dataLayer,
            request.cuboid,
            DataServiceRequestSettings(halfByte = false, request.mapping, request.annotationVersion)
          )
          agglomerateService.applyAgglomerate(dataRequest)(data)
        }.getOrElse(Fox.successful(data))
      case _ =>
        Fox.successful(data)
    }

  // Maps both the data and the requested segment id. The data is read and written as little-endian elements, so it
  // is copied only once, into the mapped byte array. The input is not mapped in place, it may be a cached bucket.
  private def applyJsonMappingIfNeeded(request: AdHocMeshRequest, data: Array[Byte]): Fox[(Array[Byte], Long)] =
    (request.mapping, request.mappingType) match {
      case (Some(mappingName), Some(MappingType.JSON)) =>
        val mappingRequest = DataServiceMappingRequest(request.dataSourceId, request.dataLayer, mappingName)
        val mappedData = new Array[Byte](data.length)
        def source = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        def target = ByteBuffer.wrap(mappedData).order(ByteOrder.LITTLE_ENDIAN)
        def mapElements[T](fromLong: Long => T, toLong: T => Long)(
            mapAll: (T => T) => Unit
        ): Fox[(Array[Byte], Long)] =
          mappingService.mappingFunction[T](mappingRequest, fromLong).map { mapping =>
            mapAll(mapping)
            (mappedData, toLong(mapping(fromLong(request.segmentId))))
          }
        request.dataLayer.elementClass match {
          case ElementClass.uint8 | ElementClass.int8 =>
            mapElements[Byte](_.toByte, _.toLong) { mapping =>
              data.indices.foreach(i => mappedData(i) = mapping(data(i)))
            }
          case ElementClass.uint16 | ElementClass.int16 =>
            mapElements[Short](_.toShort, _.toLong) { mapping =>
              val (from, to) = (source.asShortBuffer(), target.asShortBuffer())
              while (from.hasRemaining) to.put(mapping(from.get()))
            }
          case ElementClass.uint32 | ElementClass.int32 =>
            mapElements[Int](_.toInt, _.toLong) { mapping =>
              val (from, to) = (source.asIntBuffer(), target.asIntBuffer())
              while (from.hasRemaining) to.put(mapping(from.get()))
            }
          case ElementClass.uint64 | ElementClass.int64 =>
            mapElements[Long](identity, identity) { mapping =>
              val (from, to) = (source.asLongBuffer(), target.asLongBuffer())
              while (from.hasRemaining) to.put(mapping(from.get()))
            }
          case elementClass => Fox.failure(s"JSON mappings are not supported for element class $elementClass")
        }
      case _ =>
        Fox.successful((data, request.segmentId))
    }
}
