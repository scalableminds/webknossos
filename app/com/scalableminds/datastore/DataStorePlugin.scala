/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore

import javax.inject.Inject

import akka.actor.ActorSystem
import com.scalableminds.datastore.services._
import com.typesafe.scalalogging.LazyLogging
import play.api.i18n.MessagesApi
import play.api.{Play, Plugin}

class DataStorePlugin @Inject()(implicit app: play.api.Application, messagesApi: MessagesApi)
  extends Plugin
    with LazyLogging {

  implicit val system = ActorSystem("webknossos")

  lazy val dataSourceRepository = new DataSourceRepository

  lazy val confService = new ConfigurationService(app.configuration)

  lazy val oxalisServer: OxalisServer = createOxalisServer

  lazy val binaryDataService = new BinaryDataService(dataSourceRepository, confService, oxalisServer)(messagesApi)

  lazy val oxalisStatusService = new OxalisStatusService(confService, oxalisServer)

  override def onStart(): Unit = {
    logger.info("Datastore plugin started.")
    try {
      oxalisStatusService.start()
      binaryDataService.start()
    } catch {
      case e: Exception =>
        logger.error("EXCEPTION ON DataStorePlugin START: " + e.getMessage, e)
    }
  }

  override def onStop(): Unit = {
    system.terminate()
    oxalisStatusService.stop()
  }

  private def createOxalisServer =
    new OxalisServer(confService.oxalis.url, confService.dataStore.key,
      confService.dataStore.name, confService.oxalis.secured)
}

object DataStorePlugin {
  def current: Option[DataStorePlugin] =
    Play.current.plugin[DataStorePlugin]

  def dataSourceRepository: DataSourceRepository =
    DataStorePlugin.current.get.dataSourceRepository

  def binaryDataService: BinaryDataService =
    DataStorePlugin.current.get.binaryDataService
}