/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.services

import akka.actor.ActorSystem
import com.google.inject.Inject
import com.google.inject.name.Named
import com.scalableminds.webknossos.datastore.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.util.tools.FoxImplicits

class DataSourceRepository @Inject()(
                                      webKnossosServer: WebKnossosServer,
                                      @Named("webknossos-datastore") val system: ActorSystem
                                    )
    extends TemporaryStore[String, InboxDataSource]
    with FoxImplicits {

  def findByName(name: String): Option[InboxDataSource] =
    find(name)

  def findUsableByName(name: String): Option[DataSource] =
    find(name).flatMap(_.toUsable)

  def updateDataSource(dataSource: InboxDataSource): Unit = {
    insert(dataSource.id.name, dataSource)
    webKnossosServer.reportDataSource(dataSource)
  }

  def updateDataSources(dataSources: List[InboxDataSource]): Unit = {
    removeAll
    dataSources.foreach(dataSource => insert(dataSource.id.name, dataSource))
    webKnossosServer.reportDataSources(dataSources)
  }
}
