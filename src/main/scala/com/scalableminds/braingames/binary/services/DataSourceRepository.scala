/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.services

import com.scalableminds.braingames.binary.models.datasource.inbox.InboxDataSource
import com.scalableminds.braingames.binary.models.datasource.{DataSource, DataSourceId}

trait DataSourceRepository {

  def findAll: List[InboxDataSource]

  def findById(id: DataSourceId): Option[InboxDataSource]

  def findUsableById(id: DataSourceId): Option[DataSource]

  def updateDataSource(dataSource: InboxDataSource): Unit

  def updateDataSources(dataSources: List[InboxDataSource]): Unit
}
