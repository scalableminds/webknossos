/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models


import com.scalableminds.braingames.binary.requester.Cuboid
import com.scalableminds.braingames.binary.models._

trait AbstractDataRequest

trait DataRequest extends AbstractDataRequest {

  def dataSource: DataSource

  def dataLayer: DataLayer

  def dataSection: Option[String]

  def settings: DataRequestSettings
}

case class DataRequestSettings(useHalfByte: Boolean)

object DataRequestSettings {
  val default = DataRequestSettings(false)
}

case class DataReadRequest(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  cuboid: Cuboid,
  settings: DataRequestSettings)
  extends DataRequest

case class DataWriteRequest(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  cuboid: Cuboid,
  version: Long,
  data: Array[Byte])
  extends DataRequest {

  val settings = DataRequestSettings(useHalfByte = false)
}

case class DataRequestCollection[+A <: DataRequest](requests: List[A])
  extends AbstractDataRequest

object DataRequestCollection {

  def apply[A <: DataRequest](dataRequest: A): DataRequestCollection[A] =
    DataRequestCollection(List(dataRequest))
}
