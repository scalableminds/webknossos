package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.storage.AgglomerateFileKey

import scala.concurrent.ExecutionContext

trait MeshMappingHelper {

  protected val dsRemoteWebKnossosClient: DSRemoteWebknossosClient
  protected val dsRemoteTracingstoreClient: DSRemoteTracingstoreClient
  protected val binaryDataServiceHolder: BinaryDataServiceHolder

  protected def segmentIdsForAgglomerateIdIfNeeded(
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      targetMappingName: Option[String], // TODO find out if meshfile is computed for this mapping
      editableMappingTracingId: Option[String],
      agglomerateId: Long,
      token: Option[String])(implicit ec: ExecutionContext): Fox[List[Long]] =
    targetMappingName match {
      case None => Fox.successful(List(agglomerateId))
      case Some(mappingName) =>
        val agglomerateFileKey = AgglomerateFileKey(
          organizationName,
          datasetName,
          dataLayerName,
          mappingName
        )
        editableMappingTracingId match {
          case Some(tracingId) =>
            for {
              tracingstoreUri <- dsRemoteWebKnossosClient.getTracingstoreUri
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
              segmentIds <- agglomerateService.segmentIdsForAgglomerateId(
                agglomerateFileKey,
                agglomerateId
              )
            } yield segmentIds
        }
    }
}
