/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models.requests

import java.nio.file.Path

import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.{DataLayer, DataSource}
import com.scalableminds.braingames.binary.storage.DataCubeCache
import com.scalableminds.util.geometry.GenericPosition

import scala.concurrent.duration.FiniteDuration

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

case class ReadInstruction(
                            baseDir: Path,
                            dataSource: DataSource,
                            dataLayer: DataLayer,
                            bucket: BucketPosition
                          ) {
  val cube = bucket.toCube(dataLayer.lengthOfUnderlyingCubes)
}
