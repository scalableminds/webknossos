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
  LayerAttachmentDataformat
}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import org.apache.commons.io.FilenameUtils

import java.net.URI
import java.nio.file.Paths
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class AgglomerateService @Inject()(config: DataStoreConfig,
                                   zarrAgglomerateService: ZarrAgglomerateService,
                                   hdf5AgglomerateService: Hdf5AgglomerateService,
                                   remoteSourceDescriptorService: RemoteSourceDescriptorService)
    extends LazyLogging
    with FoxImplicits {
  private val agglomerateDir = "agglomerates"
  private val agglomerateFileExtension = "hdf5"
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)

  def exploreAgglomerates(organizationId: String, datasetDirectoryName: String, dataLayer: DataLayer): Set[String] = {
    val attachedAgglomerates = dataLayer.attachments.map(_.agglomerates).getOrElse(Seq.empty).map(_.name).toSet

    val layerDir = dataBaseDir.resolve(organizationId).resolve(datasetDirectoryName).resolve(dataLayer.name)
    val exploredAgglomerates = PathUtils
      .listFiles(layerDir.resolve(agglomerateDir),
                 silent = true,
                 PathUtils.fileExtensionFilter(agglomerateFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet

    attachedAgglomerates ++ exploredAgglomerates
  }

  def clearCaches(hdf5Predicate: LayerAttachment => Boolean): Int =
    // TODO also clear zarr caches
    hdf5AgglomerateService.agglomerateFileCache.clear(hdf5Predicate)

  // TODO cache?
  def lookUpAgglomerateFile(dataSourceId: DataSourceId,
                            dataLayer: DataLayer,
                            mappingName: String): Box[LayerAttachment] = {
    val registeredAttachment: Option[LayerAttachment] = dataLayer.attachments match {
      case Some(attachments) => attachments.agglomerates.find(_.name == mappingName)
      case None              => None
    }
    val localDatsetDir = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    for {
      registeredAttachmentNormalized <- tryo(registeredAttachment.map { attachment =>
        attachment.copy(
          path =
            remoteSourceDescriptorService.uriFromPathLiteral(attachment.path.toString, localDatsetDir, dataLayer.name))
      })
    } yield
      registeredAttachmentNormalized.getOrElse(
        LayerAttachment(
          mappingName,
          new URI(dataBaseDir.resolve(dataLayer.name).resolve(agglomerateDir).toString),
          LayerAttachmentDataformat.hdf5
        )
      )
  }

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte])(implicit ec: ExecutionContext,
                                                                           tc: TokenContext): Fox[Array[Byte]] =
    for {
      mappingName <- request.settings.appliedAgglomerate.toFox
      elementClass = request.dataLayer.elementClass
      agglomerateFileAttachment <- lookUpAgglomerateFile(request.dataSourceIdOrVolumeDummy,
                                                        request.dataLayer,
                                                        mappingName).toFox
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
