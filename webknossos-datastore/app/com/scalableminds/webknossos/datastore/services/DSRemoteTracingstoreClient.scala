package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.controllers.JobExportProperties
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.scalableminds.webknossos.datastore.jzarr.ZarrHeader
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationSource
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSourceLike
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.inject.ApplicationLifecycle
import play.api.libs.json.{JsObject, Json, OFormat}
import play.api.libs.ws.WSResponse

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

class DSRemoteTracingstoreClient @Inject()(
    rpc: RPC,
    config: DataStoreConfig,
    val lifecycle: ApplicationLifecycle,
) extends LazyLogging
    with FoxImplicits {

  // TODO key check in tracing store
  private val dataStoreKey: String = config.Datastore.key
  private val dataStoreName: String = config.Datastore.name
  private val dataStoreUri: String = config.Http.uri

  def getZArray(tracingId: String, mag: String, tracingStoreUri: String, accessId: String): Fox[ZarrHeader] =
    rpc(s"$tracingStoreUri/volume/zarr/$tracingId/$mag/.zarray")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[ZarrHeader]

  def getRawZarrCube(tracingId: String, mag: String, cxyz: String, tracingStoreUri: String, accessId: String): Fox[Array[Byte]] =
    rpc(s"$tracingStoreUri/volume/zarr/$tracingId/$mag/$cxyz")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithBytesResponse

  def getDataLayerMagFolderContents(tracingId: String, mag: String, tracingStoreUri: String, accessId: String): Fox[JsObject] =
    rpc(s"$tracingStoreUri/volume/zarr/$tracingId/$mag")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[JsObject]

  def getDataLayerFolderContents(tracingId: String, tracingStoreUri: String, accessId: String): Fox[JsObject] =
    rpc(s"$tracingStoreUri/volume/zarr/$tracingId")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[JsObject]

  def getZGroup(tracingId: String, tracingStoreUri: String, accessId: String): Fox[JsObject] =
    rpc(s"$tracingStoreUri/volume/zarr/$tracingId/.zgroup")
      .addQueryString("key" -> dataStoreKey)
      .addQueryString("token" -> accessId)
      .getWithJsonResponse[JsObject]
}
