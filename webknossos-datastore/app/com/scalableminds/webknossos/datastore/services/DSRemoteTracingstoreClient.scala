package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
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

class DSRemoteTracingstoreClient @Inject() (
    rpc: RPC,
    val lifecycle: ApplicationLifecycle
) extends LazyLogging
    with FoxImplicits {

  private def getZarrVersionDependantSubPath =
    (zarrVersion: Int) => if (zarrVersion == 2) "zarr" else "zarr3_experimental"

  def getZArray(tracingId: String, mag: String, tracingStoreUri: String)(implicit tc: TokenContext): Fox[ZarrHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/.zarray").withTokenFromContext
      .getWithJsonResponse[ZarrHeader]

  def getZarrJson(tracingId: String, mag: String, tracingStoreUri: String)(implicit
      tc: TokenContext
  ): Fox[Zarr3ArrayHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr3_experimental/$tracingId/$mag/zarr.json").withTokenFromContext
      .getWithJsonResponse[Zarr3ArrayHeader]

  def getVolumeLayerAsZarrLayer(
      tracingId: String,
      tracingName: Option[String],
      tracingStoreUri: String,
      zarrVersion: Int
  )(implicit tc: TokenContext): Fox[ZarrSegmentationLayer] = {
    val zarrVersionDependantSubPath = getZarrVersionDependantSubPath(zarrVersion)
    rpc(s"$tracingStoreUri/tracings/volume/$zarrVersionDependantSubPath/$tracingId/zarrSource").withTokenFromContext
      .addQueryStringOptional("tracingName", tracingName)
      .getWithJsonResponse[ZarrSegmentationLayer]
  }

  def getOmeNgffHeader(tracingId: String, tracingStoreUri: String)(implicit tc: TokenContext): Fox[NgffMetadata] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zattrs").withTokenFromContext
      .getWithJsonResponse[NgffMetadata]

  def getZarrJsonGroupHeaderWithNgff(tracingId: String, tracingStoreUri: String)(implicit
      tc: TokenContext
  ): Fox[Zarr3GroupHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr3_experimental/$tracingId/zarr.json").withTokenFromContext
      .getWithJsonResponse[Zarr3GroupHeader]

  def getRawZarrCube(tracingId: String, mag: String, cxyz: String, tracingStoreUri: String)(implicit
      tc: TokenContext
  ): Fox[Array[Byte]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/$cxyz").silent.withTokenFromContext.getWithBytesResponse

  def getDataLayerMagDirectoryContents(tracingId: String, mag: String, tracingStoreUri: String, zarrVersion: Int)(
      implicit tc: TokenContext
  ): Fox[List[String]] =
    rpc(
      s"$tracingStoreUri/tracings/volume/${getZarrVersionDependantSubPath(zarrVersion)}/json/$tracingId/$mag"
    ).withTokenFromContext.getWithJsonResponse[List[String]]

  def getDataLayerDirectoryContents(tracingId: String, tracingStoreUri: String, zarrVersion: Int)(implicit
      tc: TokenContext
  ): Fox[List[String]] =
    rpc(
      s"$tracingStoreUri/tracings/volume/${getZarrVersionDependantSubPath(zarrVersion)}/json/$tracingId"
    ).withTokenFromContext.getWithJsonResponse[List[String]]

  def getZGroup(tracingId: String, tracingStoreUri: String)(implicit tc: TokenContext): Fox[JsObject] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zgroup").withTokenFromContext.getWithJsonResponse[JsObject]

  def getEditableMappingSegmentIdsForAgglomerate(tracingStoreUri: String, tracingId: String, agglomerateId: Long)(
      implicit tc: TokenContext
  ): Fox[EditableMappingSegmentListResult] =
    rpc(s"$tracingStoreUri/tracings/mapping/$tracingId/segmentsForAgglomerate")
      .addQueryString("agglomerateId" -> agglomerateId.toString)
      .withTokenFromContext
      .silent
      .getWithJsonResponse[EditableMappingSegmentListResult]
}
