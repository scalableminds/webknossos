/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models.requests

import com.scalableminds.braingames.binary.models.datasource.{DataLayer, DataSource}

case class DataServiceRequestSettings(halfByte: Boolean)

object DataServiceRequestSettings {
  val default = DataServiceRequestSettings(halfByte = false)
}

case class DataServiceRequest(
                        dataSource: DataSource,
                        dataLayer: DataLayer,
                        cuboid: Cuboid,
                        settings: DataServiceRequestSettings
                      )
