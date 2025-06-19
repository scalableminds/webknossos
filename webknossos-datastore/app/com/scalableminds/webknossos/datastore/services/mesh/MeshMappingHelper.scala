package com.scalableminds.webknossos.datastore.services.mesh

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.webknossos.datastore.services.{
  BinaryDataServiceHolder,
  DSRemoteTracingstoreClient,
  DSRemoteWebknossosClient
}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId}
import net.liftweb.common.Full

import scala.concurrent.ExecutionContext

trait MeshMappingHelper extends FoxImplicits {

  protected val dsRemoteWebknossosClient: DSRemoteWebknossosClient
  protected val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient
  protected val binaryDataServiceHolder: BinaryDataServiceHolder

  protected def segmentIdsForAgglomerateIdIfNeeded(
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      targetMappingName: Option[String],
      editableMappingTracingId: Option[String],
      agglomerateId: Long,
      mappingNameForMeshFile: Option[String],
      omitMissing: Boolean // If true, failing lookups in the agglomerate file will just return empty list.
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    (targetMappingName, editableMappingTracingId) match {
      case (None, None) =>
        // No mapping selected, assume id matches meshFile
        Fox.successful(List(agglomerateId))
      case (Some(mappingName), None) if mappingNameForMeshFile.contains(mappingName) =>
        // Mapping selected, but meshFile has the same mapping name in its metadata, assume id matches meshFile
        Fox.successful(List(agglomerateId))
      case (Some(mappingName), None) =>
        // Mapping selected, but meshFile does not have matching mapping name in its metadata,
        // assume agglomerate id, fetch oversegmentation segment ids for it
        for {
          agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
          agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSourceId, dataLayer, mappingName)
          segmentIdsBox <- agglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId).shiftBox
          segmentIds <- segmentIdsBox match {
            case Full(segmentIds) => Fox.successful(segmentIds)
            case _                => if (omitMissing) Fox.successful(List.empty) else segmentIdsBox.toFox
          }
        } yield segmentIds
      case (Some(mappingName), Some(tracingId)) =>
        // An editable mapping tracing id is supplied. Ask the tracingstore for the segment ids. If it doesn’t know,
        // use the mappingName (here the editable mapping’s base mapping) to look it up from file.
        for {
          tracingstoreUri <- dsRemoteWebknossosClient.getTracingstoreUri
          segmentIdsResult <- dsRemoteTracingstoreClient.getEditableMappingSegmentIdsForAgglomerate(tracingstoreUri,
                                                                                                    tracingId,
                                                                                                    agglomerateId)
          segmentIds <- if (segmentIdsResult.agglomerateIdIsPresent)
            Fox.successful(segmentIdsResult.segmentIds)
          else // the agglomerate id is not present in the editable mapping. Fetch its info from the base mapping.
            for {
              agglomerateService <- binaryDataServiceHolder.binaryDataService.agglomerateServiceOpt.toFox
              agglomerateFileKey <- agglomerateService.lookUpAgglomerateFileKey(dataSourceId, dataLayer, mappingName)
              localSegmentIds <- agglomerateService.segmentIdsForAgglomerateId(agglomerateFileKey, agglomerateId)
            } yield localSegmentIds
        } yield segmentIds
      case _ => Fox.failure("Cannot determine segment ids for editable mapping without base mapping")
    }
}
