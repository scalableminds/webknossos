/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import com.scalableminds.braingames.binary.models._
import java.io.OutputStream

trait AbstractDataRequest

trait DataRequest extends AbstractDataRequest {
  def dataSource: DataSource
  def dataLayer: DataLayer
  def dataSection: Option[String]
  def resolution: Int
  def cuboid: Cuboid
  }

case class DataReadRequest(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  resolution: Int,
  cuboid: Cuboid,
  settings: DataRequestSettings) extends DataRequest

case class DataRequestSettings(
  useHalfByte: Boolean /* = false*/,
  skipInterpolation: Boolean)

object DataRequestSettings {
  val default = DataRequestSettings(false, false)
}

case class DataWriteRequest(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  resolution: Int,
  cuboid: Cuboid,
  data: Array[Byte]) extends DataRequest

case class DataRequestCollection(requests: Seq[DataRequest]) extends AbstractDataRequest

object DataRequestCollection {
  def apply(dataRequest: DataRequest): DataRequestCollection =
    DataRequestCollection(Array(dataRequest))
}
