package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.zarr.ZarrSegmentationLayer
import com.scalableminds.webknossos.datastore.jzarr.{OmeNgffHeader, ZarrHeader}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.JsObject

class DSRemoteTracingstoreClient @Inject()(
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
) extends LazyLogging
    with FoxImplicits {
  def getZArray(tracingId: String, mag: String, tracingStoreUri: String, accessToken: String): Fox[ZarrHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/.zarray")
      .addQueryString("token" -> accessToken)
      .getWithJsonResponse[ZarrHeader]

  def getVolumeLayerAsZarrLayer(tracingId: String,
                                tracingName: Option[String],
                                tracingStoreUri: String,
                                accessToken: String): Fox[ZarrSegmentationLayer] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/zarrSource")
      .addQueryString("token" -> accessToken)
      .addQueryStringOptional("tracingName", tracingName)
      .getWithJsonResponse[ZarrSegmentationLayer]

  def getOmeNgffHeader(tracingId: String, tracingStoreUri: String, accessToken: String): Fox[OmeNgffHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zattrs")
      .addQueryString("token" -> accessToken)
      .getWithJsonResponse[OmeNgffHeader]

  def getRawZarrCube(tracingId: String,
                     mag: String,
                     cxyz: String,
                     tracingStoreUri: String,
                     accessToken: String): Fox[Array[Byte]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/$cxyz")
      .addQueryString("token" -> accessToken)
      .getWithBytesResponse

  def getDataLayerMagFolderContents(tracingId: String,
                                    mag: String,
                                    tracingStoreUri: String,
                                    accessToken: String): Fox[List[String]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/json/$tracingId/$mag")
      .addQueryString("token" -> accessToken)
      .getWithJsonResponse[List[String]]

  def getDataLayerFolderContents(tracingId: String, tracingStoreUri: String, accessToken: String): Fox[List[String]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/json/$tracingId")
      .addQueryString("token" -> accessToken)
      .getWithJsonResponse[List[String]]

  def getZGroup(tracingId: String, tracingStoreUri: String, accessToken: String): Fox[JsObject] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zgroup")
      .addQueryString("token" -> accessToken)
      .getWithJsonResponse[JsObject]
}
