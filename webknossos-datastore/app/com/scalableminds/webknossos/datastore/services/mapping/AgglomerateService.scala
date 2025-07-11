package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Box.tryo
import com.scalableminds.util.tools.{Box, Fox, FoxImplicits}
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
import com.scalableminds.webknossos.datastore.storage.{AgglomerateFileKey, RemoteSourceDescriptorService}
import com.typesafe.scalalogging.LazyLogging
import org.apache.commons.io.FilenameUtils

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
  private val localAgglomeratesDir = "agglomerates"
  private val hdf5AgglomerateFileExtension = "hdf5"
  private val dataBaseDir = Paths.get(config.Datastore.baseDirectory)

  private val agglomerateFileKeyCache
    : AlfuCache[(DataSourceId, String, String), AgglomerateFileKey] = AlfuCache() // dataSourceId, layerName, mappingName → AgglomerateFileKey

  def listAgglomeratesFiles(dataSourceId: DataSourceId, dataLayer: DataLayer): Set[String] = {
    val attachedAgglomerateFileNames = dataLayer.attachments.map(_.agglomerates).getOrElse(Seq.empty).map(_.name).toSet

    val layerDir =
      dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName).resolve(dataLayer.name)
    val scannedAgglomerateFileNames = PathUtils
      .listFiles(layerDir.resolve(localAgglomeratesDir),
                 silent = true,
                 PathUtils.fileExtensionFilter(hdf5AgglomerateFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .toOption
      .getOrElse(Nil)
      .toSet

    attachedAgglomerateFileNames ++ scannedAgglomerateFileNames
  }

  def clearCaches(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    agglomerateFileKeyCache.clear {
      case (keyDataSourceId, keyLayerName, _) =>
        dataSourceId == keyDataSourceId && layerNameOpt.forall(_ == keyLayerName)
    }

    val clearedHdf5Count = hdf5AgglomerateService.clearCache { agglomerateFileKey =>
      agglomerateFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(agglomerateFileKey.layerName == _)
    }

    val clearedZarrCount = zarrAgglomerateService.clearCache {
      case (agglomerateFileKey, _) =>
        agglomerateFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(agglomerateFileKey.layerName == _)
    }

    clearedHdf5Count + clearedZarrCount
  }

  def lookUpAgglomerateFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer, mappingName: String)(
      implicit ec: ExecutionContext): Fox[AgglomerateFileKey] =
    agglomerateFileKeyCache.getOrLoad((dataSourceId, dataLayer.name, mappingName),
                                      _ => lookUpAgglomerateFileImpl(dataSourceId, dataLayer, mappingName).toFox)

  private def lookUpAgglomerateFileImpl(dataSourceId: DataSourceId,
                                        dataLayer: DataLayer,
                                        mappingName: String): Box[AgglomerateFileKey] = {
    val registeredAttachment: Option[LayerAttachment] = dataLayer.attachments match {
      case Some(attachments) => attachments.agglomerates.find(_.name == mappingName)
      case None              => None
    }
    val localDatasetDir = dataBaseDir.resolve(dataSourceId.organizationId).resolve(dataSourceId.directoryName)
    for {
      registeredAttachmentNormalized <- tryo(registeredAttachment.map { attachment =>
        attachment.copy(
          path =
            remoteSourceDescriptorService.uriFromPathLiteral(attachment.path.toString, localDatasetDir, dataLayer.name))
      })
      localFallbackAttachment = LayerAttachment(
        mappingName,
        localDatasetDir
          .resolve(dataLayer.name)
          .resolve(localAgglomeratesDir)
          .resolve(mappingName + "." + hdf5AgglomerateFileExtension)
          .toUri,
        LayerAttachmentDataformat.hdf5
      )
      selectedAttachment = registeredAttachmentNormalized.getOrElse(localFallbackAttachment)
    } yield
      AgglomerateFileKey(
        dataSourceId,
        dataLayer.name,
        selectedAttachment
      )
  }

  def applyAgglomerate(request: DataServiceDataRequest)(data: Array[Byte])(implicit ec: ExecutionContext,
                                                                           tc: TokenContext): Fox[Array[Byte]] =
    for {
      mappingName <- request.settings.appliedAgglomerate.toFox
      elementClass = request.dataLayer.elementClass
      agglomerateFileKey <- lookUpAgglomerateFileKey(request.dataSourceIdOrVolumeDummy, request.dataLayer, mappingName)
      data <- agglomerateFileKey.attachment.dataFormat match {
        case LayerAttachmentDataformat.zarr3 =>
          zarrAgglomerateService.applyAgglomerate(agglomerateFileKey, elementClass)(data)
        case LayerAttachmentDataformat.hdf5 =>
          hdf5AgglomerateService.applyAgglomerate(agglomerateFileKey, request)(data).toFox
        case _ => unsupportedDataFormat(agglomerateFileKey)
      }
    } yield data

  def generateSkeleton(agglomerateFileKey: AgglomerateFileKey,
                       agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[SkeletonTracing] =
    for {
      before <- Instant.nowFox
      skeleton <- agglomerateFileKey.attachment.dataFormat match {
        case LayerAttachmentDataformat.zarr3 =>
          zarrAgglomerateService.generateSkeleton(agglomerateFileKey, agglomerateId)
        case LayerAttachmentDataformat.hdf5 =>
          hdf5AgglomerateService.generateSkeleton(agglomerateFileKey, agglomerateId).toFox
        case _ => unsupportedDataFormat(agglomerateFileKey)
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

  def largestAgglomerateId(agglomerateFileKey: AgglomerateFileKey)(implicit ec: ExecutionContext,
                                                                   tc: TokenContext): Fox[Long] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrAgglomerateService.largestAgglomerateId(agglomerateFileKey)
      case LayerAttachmentDataformat.hdf5  => hdf5AgglomerateService.largestAgglomerateId(agglomerateFileKey).toFox
      case _                               => unsupportedDataFormat(agglomerateFileKey)
    }

  def segmentIdsForAgglomerateId(agglomerateFileKey: AgglomerateFileKey,
                                 agglomerateId: Long)(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId).toFox
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[Seq[Long]] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileKey, segmentIds)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileKey, segmentIds).toFox
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  def positionForSegmentId(agglomerateFileKey: AgglomerateFileKey, segmentId: Long)(implicit ec: ExecutionContext,
                                                                                    tc: TokenContext): Fox[Vec3Int] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.positionForSegmentId(agglomerateFileKey, segmentId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.positionForSegmentId(agglomerateFileKey, segmentId).toFox
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[AgglomerateGraph] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.generateAgglomerateGraph(agglomerateFileKey, agglomerateId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.generateAgglomerateGraph(agglomerateFileKey, agglomerateId).toFox
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  private def unsupportedDataFormat(agglomerateFileKey: AgglomerateFileKey)(implicit ec: ExecutionContext) =
    Fox.failure(
      s"Trying to load agglomerate file with unsupported data format ${agglomerateFileKey.attachment.dataFormat}")
}
