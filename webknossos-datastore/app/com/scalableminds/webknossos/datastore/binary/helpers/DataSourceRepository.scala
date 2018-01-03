/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.binary.helpers

import com.scalableminds.webknossos.datastore.binary.models.datasource.inbox.InboxDataSource
import com.scalableminds.webknossos.datastore.binary.models.datasource.{DataSource, DataSourceId}

trait DataSourceRepository {

  def findAll: List[InboxDataSource]

  // def findById(id: DataSourceId): Option[InboxDataSource]

  def findByName(name: String): Option[InboxDataSource]

  // def findUsableById(id: DataSourceId): Option[DataSource]

  def findUsableByName(name: String): Option[DataSource]

  def updateDataSource(dataSource: InboxDataSource): Unit

  def updateDataSources(dataSources: List[InboxDataSource]): Unit
}
