package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffMetadata, ZarrHeader}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{NgffZarr3GroupHeader, Zarr3ArrayHeader}
import com.scalableminds.webknossos.datastore.models.datasource.StaticSegmentationLayer
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
) extends LazyLogging {

  // Zarr v2 output is no longer served by tracingstore's latest routes (Zarr v3 is now the default there) - it
  // is only kept alive by TSLegacyApiController at this frozen, version-pinned API version. Internal RPC calls
  // that need v2 output must target that fixed path instead of the (now v3-by-default) unversioned one.
  private val legacyZarrApiVersion = 14

  private def zarrVersionDependantSubPath(zarrVersion: Int) =
    if (zarrVersion == 2) s"v$legacyZarrApiVersion/volume/zarr" else "volume/zarr"

  def getZArray(tracingId: String, mag: String, tracingStoreUri: String)(using tc: TokenContext): Fox[ZarrHeader] =
    rpc(s"$tracingStoreUri/tracings/v$legacyZarrApiVersion/volume/zarr/$tracingId/$mag/.zarray").withTokenFromContext
      .getWithJsonResponse[ZarrHeader]

  def getZarrJson(tracingId: String, mag: String, tracingStoreUri: String)(using
      tc: TokenContext
  ): Fox[Zarr3ArrayHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/zarr.json").withTokenFromContext
      .getWithJsonResponse[Zarr3ArrayHeader]

  def getVolumeLayerAsZarrLayer(
      tracingId: String,
      tracingName: Option[String],
      tracingStoreUri: String,
      zarrVersion: Int
  )(using tc: TokenContext): Fox[StaticSegmentationLayer] =
    rpc(s"$tracingStoreUri/tracings/${zarrVersionDependantSubPath(zarrVersion)}/$tracingId/zarrSource").withTokenFromContext
      .addQueryParam("tracingName", tracingName)
      .getWithJsonResponse[StaticSegmentationLayer]

  def getOmeNgffHeader(tracingId: String, tracingStoreUri: String)(using tc: TokenContext): Fox[NgffMetadata] =
    rpc(s"$tracingStoreUri/tracings/v$legacyZarrApiVersion/volume/zarr/$tracingId/.zattrs").withTokenFromContext
      .getWithJsonResponse[NgffMetadata]

  def getZarrJsonGroupHeaderWithNgff(tracingId: String, tracingStoreUri: String)(using
      tc: TokenContext
  ): Fox[NgffZarr3GroupHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/zarr.json").withTokenFromContext
      .getWithJsonResponse[NgffZarr3GroupHeader]

  def getRawZarrCube(tracingId: String, mag: String, cxyz: String, tracingStoreUri: String)(using
      tc: TokenContext
  ): Fox[Array[Byte]] =
    rpc(
      s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/$cxyz"
    ).silentEvenOnFailure.withTokenFromContext.getWithBytesResponse

  def getDataLayerMagDirectoryContents(tracingId: String, mag: String, tracingStoreUri: String, zarrVersion: Int)(using
      tc: TokenContext
  ): Fox[List[String]] =
    rpc(
      s"$tracingStoreUri/tracings/${zarrVersionDependantSubPath(zarrVersion)}/json/$tracingId/$mag"
    ).withTokenFromContext.getWithJsonResponse[List[String]]

  def getDataLayerDirectoryContents(tracingId: String, tracingStoreUri: String, zarrVersion: Int)(using
      tc: TokenContext
  ): Fox[List[String]] =
    rpc(
      s"$tracingStoreUri/tracings/${zarrVersionDependantSubPath(zarrVersion)}/json/$tracingId"
    ).withTokenFromContext.getWithJsonResponse[List[String]]

  def getZGroup(tracingId: String, tracingStoreUri: String)(using tc: TokenContext): Fox[JsObject] =
    rpc(s"$tracingStoreUri/tracings/v$legacyZarrApiVersion/volume/zarr/$tracingId/.zgroup").withTokenFromContext
      .getWithJsonResponse[JsObject]

  def getEditableMappingSegmentIdsForAgglomerate(
      tracingStoreUri: String,
      tracingId: String,
      annotationVersionOpt: Option[Long],
      agglomerateId: Long
  )(using tc: TokenContext): Fox[EditableMappingSegmentListResult] =
    rpc(s"$tracingStoreUri/tracings/mapping/$tracingId/segmentsForAgglomerate")
      .addQueryParam("agglomerateId", agglomerateId)
      .addQueryParam("version", annotationVersionOpt)
      .withTokenFromContext
      .silent
      .getWithJsonResponse[EditableMappingSegmentListResult]
}
