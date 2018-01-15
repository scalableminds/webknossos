/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.models.requests

import java.nio.file.Path

import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, SegmentationLayer}

case class DataServiceRequestSettings(halfByte: Boolean)

object DataServiceRequestSettings {
  val default = DataServiceRequestSettings(halfByte = false)
}

case class DataServiceDataRequest(
                                   dataSource: DataSource,
                                   dataLayer: DataLayer,
                                   cuboid: Cuboid,
                                   settings: DataServiceRequestSettings
                                 )

case class DataReadInstruction(
                            baseDir: Path,
                            dataSource: DataSource,
                            dataLayer: DataLayer,
                            bucket: BucketPosition
                          ) {
  val cube = bucket.toCube(dataLayer.lengthOfUnderlyingCubes(bucket.resolution))
}

case class DataServiceMappingRequest(
                                      dataSource: DataSource,
                                      dataLayer: SegmentationLayer,
                                      mapping: String
                                    )

case class MappingReadInstruction(
                                   baseDir: Path,
                                   dataSource: DataSource,
                                   mapping: String
                                 )
