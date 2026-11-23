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
import com.scalableminds.webknossos.datastore.services.mapping.{JsonMapping, MappingService}
import org.apache.pekko.actor.{Actor, ActorRef, ActorSystem, Props}
import org.apache.pekko.pattern.ask
import org.apache.pekko.routing.RoundRobinPool
import org.apache.pekko.util.Timeout

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

/** Measures the surface of a segment in the interior of the cuboid of `meshRequest`, see [[NativeSegmentSurface]]. The
  * interior is given in voxels of the cuboid, from interiorStart (inclusive) to interiorEnd (exclusive).
  */
case class SegmentSurfaceRequest(meshRequest: AdHocMeshRequest, interiorStart: Vec3Int, interiorEnd: Vec3Int)

class AdHocMeshActor(val service: AdHocMeshService, val timeout: FiniteDuration) extends Actor {

  def receive: Receive = {
    case request: AdHocMeshRequest =>
      sender() ! Await.result(service.requestAdHocMesh(request)(using request.tokenContext).futureBox, timeout)
    case request: SegmentSurfaceRequest =>
      sender() ! Await.result(
        service.measureSurface(request)(using request.meshRequest.tokenContext).futureBox,
        timeout
      )
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

  def requestAdHocMeshViaActor(request: AdHocMeshRequest): Fox[AdHocMesh] =
    Fox.fromFutureBox {
      actor.ask(request).mapTo[Box[AdHocMesh]].recover { case e: Exception =>
        Failure(e.getMessage)
      }
    }

  def requestSurfaceViaActor(request: SegmentSurfaceRequest): Fox[SegmentSurface] =
    Fox.fromFutureBox {
      actor.ask(request).mapTo[Box[SegmentSurface]].recover { case e: Exception =>
        Failure(e.getMessage)
      }
    }

  private lazy val adHocMesher = new NativeAdHocMesher()
  private lazy val segmentSurface = new NativeSegmentSurface()

  def requestAdHocMesh(request: AdHocMeshRequest)(using tc: TokenContext): Fox[AdHocMesh] = {
    val cuboid = request.cuboid
    val dataDimensions = Vec3Int(cuboid.width, cuboid.height, cuboid.depth)
    val offset = Vec3Float(
      cuboid.topLeft.voxelXInMag.toFloat,
      cuboid.topLeft.voxelYInMag.toFloat,
      cuboid.topLeft.voxelZInMag.toFloat
    )
    val scale = Vec3Float(cuboid.topLeft.mag) * Vec3Float(request.voxelSizeFactor)
    for {
      (mappedData, mappedSegmentId) <- loadMappedCuboid(request)
      mesh <- tryo(
        adHocMesher.mesh(
          mappedData,
          ElementClass.bytesPerElement(request.dataLayer.elementClass),
          dataDimensions,
          mappedSegmentId,
          offset,
          scale
        )
      ).toFox
    } yield if (request.findNeighbors) mesh else mesh.copy(neighbors = List())
  }

  def measureSurface(request: SegmentSurfaceRequest)(using tc: TokenContext): Fox[SegmentSurface] = {
    val meshRequest = request.meshRequest
    val cuboid = meshRequest.cuboid
    for {
      (mappedData, mappedSegmentId) <- loadMappedCuboid(meshRequest)
      surface <- tryo(
        segmentSurface.measureSurface(
          mappedData,
          ElementClass.bytesPerElement(meshRequest.dataLayer.elementClass),
          Vec3Int(cuboid.width, cuboid.height, cuboid.depth),
          mappedSegmentId,
          request.interiorStart,
          request.interiorEnd,
          Vec3Double(cuboid.topLeft.mag) * meshRequest.voxelSizeFactor
        )
      ).toFox
    } yield surface
  }

  /** Loads the cuboid of the request with the mapping applied, and returns it with the segment id to look for in it. */
  private def loadMappedCuboid(request: AdHocMeshRequest)(using tc: TokenContext): Fox[(Array[Byte], Long)] = {
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

    val jsonMappingRequestOpt = (request.mapping, request.mappingType) match {
      case (Some(mappingName), Some(MappingType.JSON)) =>
        Some(DataServiceMappingRequest(request.dataSourceId, request.dataLayer, mappingName))
      case _ => None
    }

    for {
      _ <- Fox.fromBool(ElementClass.segmentationElementClasses.contains(elementClass)) ?~>
        s"Ad-hoc meshing is not supported for element class $elementClass"
      // Started before loading the data, so that loading the mapping runs concurrently with it.
      jsonMappingOptFox = Fox.runOptional(jsonMappingRequestOpt)(mappingService.loadMapping)
      data <- binaryDataService.handleDataRequest(dataRequest)
      agglomerateMappedData <- applyAgglomerate(request, data) ?~> "failed to apply agglomerate for ad-hoc meshing"
      jsonMappingOpt <- jsonMappingOptFox ?~> "failed to load json mapping"
      mappedData <- applyJsonMappingIfNeeded(jsonMappingOpt, agglomerateMappedData, elementClass) ?~>
        "failed to apply json mapping"
      mappedSegmentId = jsonMappingOpt.fold(request.segmentId)(
        mappingService.mapSegmentId(_, request.segmentId, elementClass)
      )
    } yield (mappedData, mappedSegmentId)
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

  private def applyJsonMappingIfNeeded(
      jsonMappingOpt: Option[JsonMapping],
      data: Array[Byte],
      elementClass: ElementClass.Value
  ): Fox[Array[Byte]] =
    jsonMappingOpt.map(mappingService.applyMapping(_, data, elementClass).toFox).getOrElse(Fox.successful(data))
}
