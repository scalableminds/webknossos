/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.formats.knossos

import com.scalableminds.braingames.binary.models.SettingsFile
import play.api.libs.json.{JsSuccess, JsValue, Json, Reads}

sealed trait KnossosDataLayerSectionSettings {
  def sectionId: Option[String]

  def bboxSmall: List[List[Int]]

  def bboxBig: List[List[Int]]

  def resolutions: List[Int]
}

case class KnossosDataLayerSectionFullSettings(
                                         sectionId: Option[String],
                                         bboxSmall: List[List[Int]],
                                         bboxBig: List[List[Int]],
                                         resolutions: List[Int]) extends KnossosDataLayerSectionSettings

object KnossosDataLayerSectionFullSettings {
  val dataLayerSectionFullSettingsReads = Json.reads[KnossosDataLayerSectionFullSettings]
}

case class KnossosDataLayerSectionSimpleSettings(
                                           sectionId: Option[String],
                                           bbox: List[List[Int]],
                                           resolutions: List[Int]) extends KnossosDataLayerSectionSettings {
  val bboxSmall = bbox
  val bboxBig = bbox
}

object KnossosDataLayerSectionSimpleSettings {
  val dataLayerSectionSimpleSettingsReads = Json.reads[KnossosDataLayerSectionSimpleSettings]
}

object KnossosDataLayerSectionSettings extends SettingsFile[KnossosDataLayerSectionSettings] {

  import KnossosDataLayerSectionFullSettings._
  import KnossosDataLayerSectionSimpleSettings._

  val settingsFileName = "section.json"

  val settingsFileReads = new Reads[KnossosDataLayerSectionSettings] {
    def reads(json: JsValue) = {
      dataLayerSectionFullSettingsReads.reads(json) match {
        case s: JsSuccess[KnossosDataLayerSectionFullSettings] => s
        case _ => dataLayerSectionSimpleSettingsReads.reads(json)
      }
    }
  }
}
