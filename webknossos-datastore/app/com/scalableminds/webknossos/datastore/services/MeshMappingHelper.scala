package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{box2Fox, option2Fox}
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey
import net.liftweb.common.Full

import scala.concurrent.ExecutionContext

trait MeshMappingHelper {

  protected val dsRemoteWebknossosClient: DSRemoteWebknossosClient
  protected val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient
  protected val binaryDataServiceHolder: BinaryDataServiceHolder

  protected def segmentIdsForAgglomerateIdIfNeeded(
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      targetMappingName: Option[String],
      editableMappingTracingId: Option[String],
      agglomerateId: Long,
      mappingNameForMeshFile: Option[String],
      omitMissing: Boolean, // If true, failing lookups in the agglomerate file will just return empty list.
      token: Option[String])(implicit ec: ExecutionContext): Fox[List[Long]] =
    targetMappingName match {
      case None =>
        // No mapping selected, assume id matches meshfile
        Fox.successful(List(agglomerateId))
      case Some(mappingName) if mappingNameForMeshFile.contains(mappingName) =>
        // Mapping selected, but meshfile has the same mapping name in its metadata, assume id matches meshfile
        Fox.successful(List(agglomerateId))
      case Some(mappingName) =>
        // Mapping selected, but meshfile does not have matching mapping name in its metadata,
        // assume agglomerate id, fetch oversegmentation segment ids for it
        val agglomerateFileKey = AgglomerateFileKey(
          organizationName,
          datasetName,
          dataLayerName,
          mappingName
        )
        editableMappingTracingId match {
          case Some(tracingId) =>
            for {
              tracingstoreUri <- dsRemoteWebknossosClient.getTracingstoreUri
              segmentIdsResult <- dsRemoteTracingstoreClient.getEditableMappingSegmentIdsForAgglomerate(tracingstoreUri,
                                                                                                        tracingId,
                                                                                                        agglomerateId,
                                                                                                        token)
              segmentIds <- if (segmentIdsResult.agglomerateIdIsPresent)
                Fox.successful(segmentIdsResult.segmentIds)
              else
                for {
                  agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
                  localSegmentIds <- agglomerateService.segmentIdsForAgglomerateId(
                    agglomerateFileKey,
                    agglomerateId
                  )
                } yield localSegmentIds
            } yield segmentIds
          case _ =>
            for {
              agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
              segmentIdsBox <- agglomerateService
                .segmentIdsForAgglomerateId(
                  agglomerateFileKey,
                  agglomerateId
                )
                .futureBox
              segmentIds <- segmentIdsBox match {
                case Full(segmentIds) => Fox.successful(segmentIds)
                case _                => if (omitMissing) Fox.successful(List.empty) else segmentIdsBox.toFox
              }
            } yield segmentIds
        }
    }
}
