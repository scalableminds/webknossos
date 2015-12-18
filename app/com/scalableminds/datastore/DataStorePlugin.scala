/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore

import javax.inject.Inject

import akka.actor.ActorSystem
import com.scalableminds.braingames.binary.Logger
import com.scalableminds.datastore.services.{BinaryDataService, DataSourceRepository}
import play.api.i18n.MessagesApi
import play.api.{Play, Plugin}

class DataStorePlugin @Inject()(implicit app: play.api.Application, messagesApi: MessagesApi) extends Plugin {

  implicit val system = ActorSystem("datastore")

  lazy val dataSourceRepository = new DataSourceRepository

  lazy val binaryDataService = new BinaryDataService(dataSourceRepository)(messagesApi)

  override def onStart() {
    try {
      binaryDataService.start()
    } catch {
      case e: Exception =>
        Logger.logger.error("EXCEPTION ON DataStorePlugin START: " + e.getMessage)
      
    }
  }

  override def onStop() {
    system.terminate()
  }
}

object DataStorePlugin {
  def current = Play.current.plugin[DataStorePlugin]

  def dataSourceRepository = DataStorePlugin.current.get.dataSourceRepository

  def binaryDataService = DataStorePlugin.current.get.binaryDataService
}