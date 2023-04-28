package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrSegmentationLayer
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json, OFormat}

case class EditableMappingSegmentListResult(
    segmentIds: List[Long],
    agglomerateIdIsPresent: Boolean
)
object EditableMappingSegmentListResult {
  implicit val jsonFormat: OFormat[EditableMappingSegmentListResult] = Json.format[EditableMappingSegmentListResult]
}

class DSRemoteTracingstoreClient @Inject()(
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
) extends LazyLogging
    with FoxImplicits {
  def getZArray(tracingId: String, mag: String, tracingStoreUri: String, token: Option[String]): Fox[ZarrHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/.zarray")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[ZarrHeader]

  def getVolumeLayerAsZarrLayer(tracingId: String,
                                tracingName: Option[String],
                                tracingStoreUri: String,
                                token: Option[String]): Fox[ZarrSegmentationLayer] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/zarrSource")
      .addQueryStringOptional("token", token)
      .addQueryStringOptional("tracingName", tracingName)
      .getWithJsonResponse[ZarrSegmentationLayer]

  def getOmeNgffHeader(tracingId: String, tracingStoreUri: String, token: Option[String]): Fox[NgffMetadata] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zattrs")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[NgffMetadata]

  def getRawZarrCube(tracingId: String,
                     mag: String,
                     cxyz: String,
                     tracingStoreUri: String,
                     token: Option[String]): Fox[Array[Byte]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/$cxyz").silent
      .addQueryStringOptional("token", token)
      .getWithBytesResponse

  def getDataLayerMagFolderContents(tracingId: String,
                                    mag: String,
                                    tracingStoreUri: String,
                                    token: Option[String]): Fox[List[String]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/json/$tracingId/$mag")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[List[String]]

  def getDataLayerFolderContents(tracingId: String, tracingStoreUri: String, token: Option[String]): Fox[List[String]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/json/$tracingId")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[List[String]]

  def getZGroup(tracingId: String, tracingStoreUri: String, token: Option[String]): Fox[JsObject] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zgroup")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[JsObject]

  def getEditableMappingSegmentIdsForAgglomerate(tracingStoreUri: String,
                                                 tracingId: String,
                                                 agglomerateId: Long,
                                                 token: Option[String]): Fox[EditableMappingSegmentListResult] =
    rpc(s"$tracingStoreUri/tracings/mapping/$tracingId/segmentsForAgglomerate")
      .addQueryString("agglomerateId" -> agglomerateId.toString)
      .addQueryStringOptional("token", token)
      .silent
      .getWithJsonResponse[EditableMappingSegmentListResult]
}
