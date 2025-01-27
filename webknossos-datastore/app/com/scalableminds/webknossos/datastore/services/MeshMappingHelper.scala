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
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      targetMappingName: Option[String],
      editableMappingTracingId: Option[String],
      agglomerateId: Long,
      mappingNameForMeshFile: Option[String],
      omitMissing: Boolean, // If true, failing lookups in the agglomerate file will just return empty list.
      token: Option[String])(implicit ec: ExecutionContext): Fox[List[Long]] =
    (targetMappingName, editableMappingTracingId) match {
      case (None, None) =>
        // No mapping selected, assume id matches meshfile
        Fox.successful(List(agglomerateId))
      case (Some(mappingName), None) if mappingNameForMeshFile.contains(mappingName) =>
        // Mapping selected, but meshfile has the same mapping name in its metadata, assume id matches meshfile
        Fox.successful(List(agglomerateId))
      case (Some(mappingName), None) =>
        // Mapping selected, but meshfile does not have matching mapping name in its metadata,
        // assume agglomerate id, fetch oversegmentation segment ids for it
        for {
          agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
          segmentIdsBox <- agglomerateService
            .segmentIdsForAgglomerateId(
              AgglomerateFileKey(
                organizationId,
                datasetDirectoryName,
                dataLayerName,
                mappingName
              ),
              agglomerateId
            )
            .futureBox
          segmentIds <- segmentIdsBox match {
            case Full(segmentIds) => Fox.successful(segmentIds)
            case _                => if (omitMissing) Fox.successful(List.empty) else segmentIdsBox.toFox
          }
        } yield segmentIds
      case (mappingNameOpt, Some(tracingId)) =>
        // An editable mapping tracing id is supplied. Ask the tracingstore for the segment ids. If it doesn’t know,
        // use the mappingName (here the editable mapping’s base mapping) to look it up from file.
        for {
          tracingstoreUri <- dsRemoteWebknossosClient.getTracingstoreUri
          segmentIdsResult <- dsRemoteTracingstoreClient.getEditableMappingSegmentIdsForAgglomerate(tracingstoreUri,
                                                                                                    tracingId,
                                                                                                    agglomerateId,
                                                                                                    token)
          segmentIds <- if (segmentIdsResult.agglomerateIdIsPresent)
            Fox.successful(segmentIdsResult.segmentIds)
          else // the agglomerate id is not present in the editable mapping. Fetch its info from the base mapping.
            for {
              agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
              localSegmentIds <- mappingNameOpt match {
                case Some(mappingName) =>
                  agglomerateService.segmentIdsForAgglomerateId(
                    AgglomerateFileKey(
                      organizationId,
                      datasetDirectoryName,
                      dataLayerName,
                      mappingName
                    ),
                    agglomerateId
                  )
                case None =>
                  Full(List(agglomerateId)) // Proofreading with no base mapping. Segment id is mapped to self.
              }
            } yield localSegmentIds
        } yield segmentIds
    }
}
