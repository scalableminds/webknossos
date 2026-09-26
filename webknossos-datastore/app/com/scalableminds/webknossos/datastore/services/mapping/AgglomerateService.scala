package com.scalableminds.webknossos.datastore.services.mapping

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.{Box, Empty}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.AgglomerateGraph.AgglomerateGraph
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, LayerAttachmentDataformat}
import com.scalableminds.webknossos.datastore.models.requests.DataServiceDataRequest
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

class AgglomerateService @Inject() (
    zarrAgglomerateService: ZarrAgglomerateService,
    hdf5AgglomerateService: Hdf5AgglomerateService,
    pcgAgglomerateService: PcgAgglomerateService,
    config: DataStoreConfig
) extends LazyLogging {

  private val agglomerateFileKeyCache: AlfuCache[(DataSourceId, String, String), AgglomerateFileKey] =
    AlfuCache() // dataSourceId, layerName, mappingName → AgglomerateFileKey

  def listAgglomeratesFiles(dataLayer: DataLayer): Seq[String] =
    dataLayer.attachments.map(_.agglomerates).getOrElse(Seq.empty).map(_.name)

  def clearCaches(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    agglomerateFileKeyCache.clear { case (keyDataSourceId, keyLayerName, _) =>
      dataSourceId == keyDataSourceId && layerNameOpt.forall(_ == keyLayerName)
    }

    val clearedHdf5Count = hdf5AgglomerateService.clearCache { agglomerateFileKey =>
      agglomerateFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(agglomerateFileKey.layerName == _)
    }

    val clearedZarrCount = zarrAgglomerateService.clearCache { case (agglomerateFileKey, _) =>
      agglomerateFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(agglomerateFileKey.layerName == _)
    }

    val clearedPcgCount = pcgAgglomerateService.clearCache { agglomerateFileKey =>
      agglomerateFileKey.dataSourceId == dataSourceId && layerNameOpt.forall(agglomerateFileKey.layerName == _)
    }

    clearedHdf5Count + clearedZarrCount + clearedPcgCount
  }

  def lookUpAgglomerateFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer, mappingName: String)(implicit
      ec: ExecutionContext
  ): Fox[AgglomerateFileKey] =
    agglomerateFileKeyCache.getOrLoad(
      (dataSourceId, dataLayer.name, mappingName),
      _ => lookUpAgglomerateFileImpl(dataSourceId, dataLayer, mappingName).toFox
    )

  private def lookUpAgglomerateFileImpl(
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      mappingName: String
  ): Box[AgglomerateFileKey] =
    for {
      attachment <- dataLayer.attachments match {
        case Some(attachments) => Box.fromOption(attachments.agglomerates.find(_.name == mappingName))
        case None              => Empty
      }
      _ <- Box.fromBool(attachment.path.isAbsolute) ?~> Msg.AgglomerateFile.pathNotAbsolute
    } yield AgglomerateFileKey(
      dataSourceId,
      dataLayer.name,
      attachment
    )

  def applyAgglomerate(
      request: DataServiceDataRequest
  )(data: Array[Byte])(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Byte]] =
    for {
      mappingName <- request.settings.appliedAgglomerate.toFox
      elementClass = request.dataLayer.elementClass
      agglomerateFileKey <- lookUpAgglomerateFileKey(request.dataSourceIdOrVolumeDummy, request.dataLayer, mappingName)
      data <- agglomerateFileKey.attachment.dataFormat match {
        case LayerAttachmentDataformat.zarr3 =>
          zarrAgglomerateService.applyAgglomerate(agglomerateFileKey, elementClass)(data)
        case LayerAttachmentDataformat.hdf5 =>
          hdf5AgglomerateService.applyAgglomerate(agglomerateFileKey, request)(data).toFox
        case LayerAttachmentDataformat.pcg =>
          pcgAgglomerateService.applyAgglomerate(agglomerateFileKey, elementClass)(data)
        case _ => unsupportedDataFormat(agglomerateFileKey)
      }
    } yield data

  def generateTreeAsSkeleton(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[SkeletonTracing] =
    for {
      before <- Instant.nowFox
      treeAsSkeleton <- agglomerateFileKey.attachment.dataFormat match {
        case LayerAttachmentDataformat.zarr3 =>
          zarrAgglomerateService.generateTree(agglomerateFileKey, agglomerateId)
        case LayerAttachmentDataformat.hdf5 =>
          hdf5AgglomerateService.generateTree(agglomerateFileKey, agglomerateId).toFox
        case LayerAttachmentDataformat.pcg =>
          pcgAgglomerateService.generateTree(agglomerateFileKey, agglomerateId)
        case _ => unsupportedDataFormat(agglomerateFileKey)
      }
      _ = if (Instant.since(before) > (100 milliseconds)) {
        Instant.logSince(
          before,
          s"Generating tree from agglomerate file with ${treeAsSkeleton.trees.headOption
              .map(_.edges.length)
              .getOrElse(0)} edges, ${treeAsSkeleton.trees.headOption.map(_.nodes.length).getOrElse(0)} nodes",
          logger
        )
      }
    } yield treeAsSkeleton

  def largestAgglomerateId(
      agglomerateFileKey: AgglomerateFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 => zarrAgglomerateService.largestAgglomerateId(agglomerateFileKey)
      case LayerAttachmentDataformat.hdf5  => hdf5AgglomerateService.largestAgglomerateId(agglomerateFileKey).toFox
      case LayerAttachmentDataformat.pcg   => pcgAgglomerateService.largestAgglomerateId(agglomerateFileKey)
      case _                               => unsupportedDataFormat(agglomerateFileKey)
    }

  def segmentIdsForAgglomerateId(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Long]] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId).toFox
      case LayerAttachmentDataformat.pcg =>
        pcgAgglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  def agglomerateIdsForSegmentIds(agglomerateFileKey: AgglomerateFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Long]] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileKey, segmentIds)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileKey, segmentIds).toFox
      case LayerAttachmentDataformat.pcg =>
        pcgAgglomerateService.agglomerateIdsForSegmentIds(agglomerateFileKey, segmentIds)
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  /** `datasetId` and `dataLayer` are only used by the PCG branch, which has no stored positions and has to find one by
    * reading the layer itself. The file formats keep positions in the agglomerate file and ignore both.
    */
  def positionForSegmentId(
      agglomerateFileKey: AgglomerateFileKey,
      segmentId: Long,
      datasetId: Option[ObjectId],
      dataLayer: DataLayer,
      loadBucket: DataServiceDataRequest => Fox[Array[Byte]]
  )(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Vec3Int] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.positionForSegmentId(agglomerateFileKey, segmentId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.positionForSegmentId(agglomerateFileKey, segmentId).toFox
      case LayerAttachmentDataformat.pcg =>
        pcgAgglomerateService.positionForSegmentId(agglomerateFileKey, segmentId, datasetId, dataLayer, loadBucket)
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  def generateAgglomerateGraph(agglomerateFileKey: AgglomerateFileKey, agglomerateId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[AgglomerateGraph] =
    agglomerateFileKey.attachment.dataFormat match {
      case LayerAttachmentDataformat.zarr3 =>
        zarrAgglomerateService.generateAgglomerateGraph(agglomerateFileKey, agglomerateId)
      case LayerAttachmentDataformat.hdf5 =>
        hdf5AgglomerateService.generateAgglomerateGraph(agglomerateFileKey, agglomerateId).toFox
      case LayerAttachmentDataformat.pcg =>
        pcgAgglomerateService.generateAgglomerateGraph(agglomerateFileKey, agglomerateId)
      case _ => unsupportedDataFormat(agglomerateFileKey)
    }

  private def unsupportedDataFormat(agglomerateFileKey: AgglomerateFileKey)(implicit ec: ExecutionContext) =
    Fox.failure(
      s"Trying to load agglomerate file with unsupported data format ${agglomerateFileKey.attachment.dataFormat}"
    )
}
