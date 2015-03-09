/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore

import play.api.{Play, Logger, Plugin}
import com.scalableminds.datastore.services.{DataSourceRepository, BinaryDataService}
import scala.concurrent.duration._
import akka.actor.{ActorSystem, PoisonPill, Props}

class DataStorePlugin(app: play.api.Application) extends Plugin {

  implicit val system = ActorSystem("datastore")

  val dataSourceRepository = new DataSourceRepository

  val binaryDataService = new BinaryDataService(dataSourceRepository)

  override def onStart() {
    binaryDataService.start()
  }

  override def onStop() {
    system.shutdown()
  }
}

object DataStorePlugin {
  def current = Play.current.plugin[DataStorePlugin]

  def dataSourceRepository = DataStorePlugin.current.get.dataSourceRepository

  def binaryDataService = DataStorePlugin.current.get.binaryDataService
}