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

  // TODO key check in tracing store
  private val dataStoreKey: String = config.Datastore.key

  def getZArray(tracingId: String, mag: String, tracingStoreUri: String, accessId: String): Fox[ZarrHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/.zarray")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[ZarrHeader]

  def getVolumeLayerAsZarrLayer(tracingId: String,
                                tracingStoreUri: String,
                                accessId: String): Fox[ZarrSegmentationLayer] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/zarrSource")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[ZarrSegmentationLayer]

  def getOmeNgffHeader(tracingId: String, tracingStoreUri: String, accessId: String): Fox[OmeNgffHeader] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zattrs")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[OmeNgffHeader]

  def getRawZarrCube(tracingId: String,
                     mag: String,
                     cxyz: String,
                     tracingStoreUri: String,
                     accessId: String): Fox[Array[Byte]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/$mag/$cxyz")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithBytesResponse

  def getDataLayerMagFolderContents(tracingId: String,
                                    mag: String,
                                    tracingStoreUri: String,
                                    accessId: String): Fox[Map[String, String]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/json/$tracingId/$mag")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[Map[String, String]]

  def getDataLayerFolderContents(tracingId: String,
                                 tracingStoreUri: String,
                                 accessId: String): Fox[Map[String, String]] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/json/$tracingId")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[Map[String, String]]

  def getZGroup(tracingId: String, tracingStoreUri: String, accessId: String): Fox[JsObject] =
    rpc(s"$tracingStoreUri/tracings/volume/zarr/$tracingId/.zgroup")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[JsObject]
}
