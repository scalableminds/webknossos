/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.models

trait DataAccessInstruction {
  def dataSource: DataSource

  def dataLayer: DataLayer
}

case class CubeReadInstruction(
  dataSource: DataSource,
  dataLayer: DataLayer,
  position: CubePosition,
  settings: DataRequestSettings) extends DataAccessInstruction

case class BucketReadInstruction(
  dataSource: DataSource,
  dataLayer: DataLayer,
  position: BucketPosition,
  settings: DataRequestSettings) extends DataAccessInstruction {

  def toCubeReadInstruction(cubeLength: Int) =
    CubeReadInstruction(dataSource, dataLayer, position.toCube(cubeLength), settings)
}

case class BucketWriteInstruction(
  dataSource: DataSource,
  dataLayer: DataLayer,
  position: BucketPosition,
  data: Array[Byte]) extends DataAccessInstruction