/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.nio.file.Paths

import akka.actor.{ActorRef, ActorSystem, Props}
import akka.util.Timeout
import com.scalableminds.braingames.binary.requester
import com.scalableminds.braingames.binary.requester.{CachedBlock, DataCubeCache}
import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.repository.DataSourceInbox
import com.scalableminds.braingames.binary.watcher._
import com.scalableminds.util.tools.ExtendedTypes.ExtendedArraySeq
import com.scalableminds.util.cache.LRUConcurrentCache
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.Fox
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import play.api.i18n.I18nSupport

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.duration._

trait BinaryDataService
  extends DataSourceService
    with BinaryDataRequestBuilder
    with DataLayerMappingService
    with DataDownloadService
    with I18nSupport
    with LazyLogging {

  implicit def system: ActorSystem

  def dataSourceRepository: DataSourceRepository

  def config: Config

  def serverUrl: String

  lazy implicit val executor: ExecutionContextExecutor =
    system.dispatcher

  var repositoryWatcher: Option[ActorRef] =
    None

  private lazy implicit val timeout =
    Timeout(config.getInt("braingames.binary.loadTimeout").seconds)

  private lazy val dataSourceRepositoryDir =
    PathUtils.ensureDirectory(Paths.get(config.getString("braingames.binary.baseFolder")))

  private val binDataCache =
    new DataCubeCache(config.getInt("braingames.binary.cacheMaxSize"))

  private lazy val dataRequester =
    new requester.DataRequester(config.getConfig("braingames.binary"), binDataCache, dataSourceRepository)

  lazy val dataSourceInbox: DataSourceInbox =
    DataSourceInbox.create(dataSourceRepository, serverUrl, dataRequester, system)(messagesApi)

  def start(): Unit = {
    val repositoryWatcherConfig =
      config.getConfig("braingames.binary.changeHandler")

    val repositoryWatchActor =
      system.actorOf(
        Props(classOf[DirectoryWatcherActor],
          repositoryWatcherConfig,
          dataSourceRepositoryDir,
          true,
          dataSourceInbox.handler),
        name = "directoryWatcher")

    repositoryWatcher = Some(repositoryWatchActor)

    repositoryWatchActor ! DirectoryWatcherActor.StartWatching
  }

  def handleRequests[T <: DataRequest](coll: DataRequestCollection[T]): Fox[Array[Byte]] = {
    val resultsPromise = Fox.combined(coll.requests.map{
      case r: DataReadRequest => handleReadRequest(r)
      case w: DataWriteRequest => handleWriteRequest(w)
    })
    resultsPromise.map(_.appendArrays)
  }

  def handleWriteRequest(request: DataWriteRequest): Fox[Array[Byte]] = {
    dataRequester.handleWriteRequest(request)
  }

  def handleReadRequest(request: DataReadRequest): Fox[Array[Byte]] = {
    dataRequester.handleReadRequest(request)
  }
}