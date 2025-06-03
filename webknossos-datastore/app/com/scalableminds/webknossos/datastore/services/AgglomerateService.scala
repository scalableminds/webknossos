package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayer,
  DataSourceId,
  LayerAttachment,
  LayerAttachmentDataformat,
}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FilenameUtils

import java.net.URI
import java.nio.file.Paths
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class AgglomerateService @Inject()(config: DataStoreConfig,
                                   zarrAgglomerateService: ZarrAgglomerateService,
                                   hdf5AgglomerateService: Hdf5AgglomerateService)
    extends LazyLogging
    with FoxImplicits {
  private val agglomerateDir = "agglomerates"
  private val agglomerateFileExtension = "hdf5"
  private val datasetName = "/segment_to_agglomerate"
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)
  private val cumsumFileName = "cumsum.json"

  // TODO remove
  private val useZarr = false

  def exploreAgglomerates(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Set[String] = {
    val layerDir = dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName).resolve(dataLayerName)
    PathUtils
      .listFiles(layerDir.resolve(agglomerateDir),
                 silent = true,
                 PathUtils.fileExtensionFilter(agglomerateFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil) // TODO explore zarr agglomerates?
      .toSet ++ Set(
      "agglomerate_view_5",
      "agglomerate_view_10",
      "agglomerate_view_15",
      "agglomerate_view_20",
      "agglomerate_view_25",
      "agglomerate_view_30",
      "agglomerate_view_35",
      "agglomerate_view_40",
      "agglomerate_view_45",
      "agglomerate_view_50",
      "agglomerate_view_55",
      "agglomerate_view_60",
      "agglomerate_view_65",
      "agglomerate_view_70",
      "agglomerate_view_75",
      "agglomerate_view_80",
      "agglomerate_view_85",
      "agglomerate_view_90",
      "agglomerate_view_95",
      "agglomerate_view_100"
    )
  }

  // TODO cache?
  def lookUpAgglomerateFile(dataSourceId: DataSourceId, dataLayer: DataLayer, mappingName: String): LayerAttachment = {
    val registeredAttachment: Option[LayerAttachment] = dataLayer.attachments match {
      case Some(attachments) => attachments.agglomerates.find(_.name == mappingName)
      case None              => None
    }
    registeredAttachment.getOrElse(
      LayerAttachment(
        mappingName,
        new URI(
          dataBaseDir
            .resolve(dataSourceId.organizationId)
            .resolve(dataSourceId.directoryName)
            .resolve(dataLayer.name)
            .resolve(agglomerateDir)
            .toString),
        LayerAttachmentDataformat.hdf5
      )
    )
  }

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte])(implicit ec: ExecutionContext,
                                                                           tc: TokenContext): Fox[Array[Byte]] =
    for {
      mappingName <- request.settings.appliedAgglomerate.toFox
      elementClass = request.dataLayer.elementClass
      agglomerateFileAttachment = lookUpAgglomerateFile(request.dataSourceIdOrVolumeDummy,
                                                        request.dataLayer,
                                                        mappingName)
      data <- agglomerateFileAttachment.dataFormat match {
        case LayerAttachmentDataformat.zarr3 =>
          zarrAgglomerateService.applyAgglomerate(agglomerateFileAttachment, elementClass)(data)
        case _ => hdf5AgglomerateService.applyAgglomerate(agglomerateFileAttachment, request)(data).toFox
      }
    } yield data

  def generateSkeleton(agglomerateFileAttachment: LayerAttachment,
                       agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[SkeletonTracing] =
    for {
      before <- Instant.nowFox
      skeleton <- agglomerateFileAttachment.dataFormat match {
        case LayerAttachmentDataformat.zarr3 =>
          zarrAgglomerateService.generateSkeleton(agglomerateFileAttachment, agglomerateId)
        case _ => hdf5AgglomerateService.generateSkeleton(agglomerateFileAttachment, agglomerateId).toFox
      }
      _ = if (Instant.since(before) > (100 milliseconds)) {
        Instant.logSince(
          before,
          s"Generating skeleton from agglomerate file with ${skeleton.trees.headOption
            .map(_.edges.length)
            .getOrElse(0)} edges, ${skeleton.trees.headOption.map(_.nodes.length).getOrElse(0)} nodes",
          logger
        )
      }
    } yield skeleton

  def largestAgglomerateId(agglomerateFileAttachment: LayerAttachment)(implicit ec: ExecutionContext,
                                                                       tc: TokenContext): Fox[Long] =
    agglomerateFileAttachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrAgglomerateService.largestAgglomerateId(agglomerateFileAttachment)
      case _                               => hdf5AgglomerateService.largestAgglomerateId(agglomerateFileAttachment).toFox
    }

  def segmentIdsForAgglomerateId(agglomerateFileAttachment: LayerAttachment,
                                 agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    agglomerateFileAttachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.segmentIdsForAgglomerateId(agglomerateFileAttachment, agglomerateId)
      case _ => hdf5AgglomerateService.segmentIdsForAgglomerateId(agglomerateFileAttachment, agglomerateId).toFox
    }

  def agglomerateIdsForSegmentIds(agglomerateFileAttachment: LayerAttachment, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    agglomerateFileAttachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileAttachment, segmentIds)
      case _ => hdf5AgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileAttachment, segmentIds).toFox
    }

  def positionForSegmentId(agglomerateFileAttachment: LayerAttachment,
                           segmentId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Vec3Int] =
    agglomerateFileAttachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.positionForSegmentId(agglomerateFileAttachment, segmentId)
      case _ => hdf5AgglomerateService.positionForSegmentId(agglomerateFileAttachment, segmentId).toFox
    }

  def generateAgglomerateGraph(agglomerateFileAttachment: LayerAttachment, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AgglomerateGraph] =
    agglomerateFileAttachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.generateAgglomerateGraph(agglomerateFileAttachment, agglomerateId)
      case _ =>
        hdf5AgglomerateService.generateAgglomerateGraph(agglomerateFileAttachment, agglomerateId).toFox
    }

}
