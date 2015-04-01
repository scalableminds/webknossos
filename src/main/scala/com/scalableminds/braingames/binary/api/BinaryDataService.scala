/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import java.io.OutputStream
import java.nio.file.{Paths, Path}

import akka.actor.ActorSystem
import akka.agent.Agent
import akka.actor.ActorRef
import com.scalableminds.braingames.binary._
import scala.concurrent.Future
import akka.actor.Props
import akka.pattern.ask
import akka.routing.RoundRobinRouter
import com.scalableminds.braingames.binary.watcher._
import akka.util.Timeout
import scala.concurrent.duration._
import com.scalableminds.braingames.binary.models._
import akka.pattern.AskTimeoutException
import com.typesafe.config.Config
import net.liftweb.common.Box
import com.scalableminds.braingames.binary.watcher.StartWatching
import com.scalableminds.braingames.binary.repository.DataSourceInbox
import com.scalableminds.util.io.PathUtils

trait BinaryDataService extends DataSourceService with BinaryDataHelpers with DataLayerMappingHelpers with DataDownloadHelper{

  import Logger._

  implicit def system: ActorSystem

  def dataSourceRepository: DataSourceRepository

  def config: Config

  def serverUrl: String

  lazy implicit val executor = system.dispatcher

  val dataSourceInbox = DataSourceInbox.create(dataSourceRepository, serverUrl, system)

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
      .withRouter(new RoundRobinRouter(nrOfBinRequestActors)), "dataRequestActor")
  }

  var repositoryWatcher: Option[ActorRef] = None

  def start() {
    val repositoryWatcherConfig = config.getConfig("braingames.binary.changeHandler")
    val repositoryWatchActor =
      system.actorOf(
        Props(classOf[DirectoryWatcherActor], repositoryWatcherConfig, dataSourceInbox.handler),
        name = "directoryWatcher")

    repositoryWatcher = Some(repositoryWatchActor)

    repositoryWatchActor ! StartWatching(dataSourceRepositoryDir, true)
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