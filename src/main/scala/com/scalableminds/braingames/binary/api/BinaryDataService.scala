/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.io.OutputStream
import java.nio.file.{Paths, Path}

import akka.actor.ActorSystem
import akka.agent.Agent
import akka.actor.ActorRef
import akka.routing.RoundRobinPool
import com.scalableminds.braingames.binary._
import play.api.i18n.I18nSupport
import scala.concurrent.Future
import akka.actor.Props
import akka.pattern.ask
import com.scalableminds.braingames.binary.watcher._
import akka.util.Timeout
import scala.concurrent.duration._
import com.scalableminds.braingames.binary.models._
import akka.pattern.AskTimeoutException
import com.typesafe.config.Config
import net.liftweb.common.Box
import com.scalableminds.braingames.binary.repository.DataSourceInbox
import com.scalableminds.util.io.PathUtils

trait BinaryDataService extends DataSourceService with BinaryDataHelpers with DataLayerMappingHelpers with DataDownloadHelper with I18nSupport{

  import Logger._

  implicit def system: ActorSystem

  def dataSourceRepository: DataSourceRepository

  def config: Config

  def serverUrl: String

  lazy implicit val executor = system.dispatcher

  lazy val dataSourceInbox = DataSourceInbox.create(dataSourceRepository, serverUrl, system)(messagesApi)

  lazy implicit val timeout = Timeout(config.getInt("braingames.binary.loadTimeout") seconds)

  lazy val dataSourceRepositoryDir = PathUtils.ensureDirectory(Paths.get(config.getString("braingames.binary.baseFolder")))

  val binDataCache = Agent[Map[CachedBlock, Future[Box[Array[Byte]]]]](Map.empty)

  lazy val dataRequestActor = {
    val nrOfBinRequestActors = config.getInt("braingames.binary.nrOfBinRequestActors")
    val props = Props(classOf[DataRequestActor],
      config.getConfig("braingames.binary"),
      binDataCache,
      dataSourceRepository)

    system.actorOf(props
      .withRouter(new RoundRobinPool(nrOfBinRequestActors)), "dataRequestActor")
  }

  var repositoryWatcher: Option[ActorRef] = None

  def start() {
    val repositoryWatcherConfig = config.getConfig("braingames.binary.changeHandler")
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

  def handleDataRequest(request: AbstractDataRequest): Future[Option[Array[Byte]]] = {
    askDataRequestActor(request)
  }

  def askDataRequestActor[T](request: T) = {
    val future = (dataRequestActor ? request) recover {
      case e: AskTimeoutException =>
        logger.warn("Data request to DataRequestActor timed out!")
        None
    }

    future.mapTo[Option[Array[Byte]]]
  }

}