/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import com.scalableminds.braingames.binary.models._

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
  useHalfByte: Boolean)

object DataRequestSettings {
  val default = DataRequestSettings(false)
}

case class DataWriteRequest(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  resolution: Int,
  cuboid: Cuboid,
  data: Array[Byte]) extends DataRequest

case class DataRequestCollection[+A <: DataRequest](requests: List[A]) extends AbstractDataRequest

object DataRequestCollection {
  def apply[A <: DataRequest](dataRequest: A): DataRequestCollection[A] =
    DataRequestCollection(List(dataRequest))
}
