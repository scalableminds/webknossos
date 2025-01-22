package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.layers.ZarrSegmentationLayer
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{Zarr3ArrayHeader, Zarr3GroupHeader}
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
  private def getZarrVersionDependantSubPath =
    (zarrVersion: Int) => if (zarrVersion == 2) "zarr" else "zarr3_experimental"

  def getZArray(tracingId: String, mag: String, tracingStoreUri: String, token: Option[String]): Fox[ZarrHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/.zarray")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[ZarrHeader]

  def getZarrJson(tracingId: String,
                  mag: String,
                  tracingStoreUri: String,
                  token: Option[String]): Fox[Zarr3ArrayHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr3_experimental/$tracingId/$mag/zarr.json")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[Zarr3ArrayHeader]

  def getVolumeLayerAsZarrLayer(tracingId: String,
                                tracingName: Option[String],
                                tracingStoreUri: String,
                                token: Option[String],
                                zarrVersion: Int): Fox[ZarrSegmentationLayer] = {
    val zarrVersionDependantSubPath = getZarrVersionDependantSubPath(zarrVersion)
    rpc(s"$tracingStoreUri/tracings/volume/$zarrVersionDependantSubPath/$tracingId/zarrSource")
      .addQueryStringOptional("token", token)
      .addQueryStringOptional("tracingName", tracingName)
      .getWithJsonResponse[ZarrSegmentationLayer]
  }

  def getOmeNgffHeader(tracingId: String, tracingStoreUri: String, token: Option[String]): Fox[NgffMetadata] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zattrs")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[NgffMetadata]

  def getZarrJsonGroupHeaderWithNgff(tracingId: String,
                                     tracingStoreUri: String,
                                     token: Option[String]): Fox[Zarr3GroupHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr3_experimental/$tracingId/zarr.json")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[Zarr3GroupHeader]

  def getRawZarrCube(tracingId: String,
                     mag: String,
                     cxyz: String,
                     tracingStoreUri: String,
                     token: Option[String]): Fox[Array[Byte]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/$cxyz").silent
      .addQueryStringOptional("token", token)
      .getWithBytesResponse

  def getDataLayerMagDirectoryContents(tracingId: String,
                                       mag: String,
                                       tracingStoreUri: String,
                                       token: Option[String],
                                       zarrVersion: Int): Fox[List[String]] =
    rpc(s"$tracingStoreUri/tracings/volume/${getZarrVersionDependantSubPath(zarrVersion)}/json/$tracingId/$mag")
      .addQueryStringOptional("token", token)
      .getWithJsonResponse[List[String]]

  def getDataLayerDirectoryContents(tracingId: String,
                                    tracingStoreUri: String,
                                    token: Option[String],
                                    zarrVersion: Int): Fox[List[String]] =
    rpc(s"$tracingStoreUri/tracings/volume/${getZarrVersionDependantSubPath(zarrVersion)}/json/$tracingId")
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
