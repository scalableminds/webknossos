/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore

import javax.inject.Inject

import akka.actor.ActorSystem
import com.scalableminds.datastore.services.{BinaryDataService, DataSourceRepository}
import play.api.{Play, Plugin}

class DataStorePlugin @Inject()(implicit app: play.api.Application) extends Plugin {

  implicit val system = ActorSystem("datastore")

  val dataSourceRepository = new DataSourceRepository

  val binaryDataService = new BinaryDataService(dataSourceRepository)

  override def onStart() {
    binaryDataService.start()
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