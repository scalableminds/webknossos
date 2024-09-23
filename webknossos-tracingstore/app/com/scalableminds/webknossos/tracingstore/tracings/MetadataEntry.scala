package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import play.api.libs.json.{Json, OFormat}
import play.api.libs.json.Json.WithDefaultValues

case class MetadataEntry(key: String,
                         stringValue: Option[String] = None,
                         boolValue: Option[Boolean] = None,
                         numberValue: Option[Double] = None,
                         stringListValue: Option[Seq[String]] = None) {
  def toProto: MetadataEntryProto = MetadataEntryProto(
    key,
    stringValue,
    boolValue,
    numberValue,
    stringListValue.getOrElse(Seq.empty)
  )
}

object MetadataEntry {
  def fromProto(propertyProto: MetadataEntryProto): MetadataEntry =
    MetadataEntry(
      propertyProto.key,
      propertyProto.stringValue,
      propertyProto.boolValue,
      propertyProto.numberValue,
      if (propertyProto.stringListValue.isEmpty) None else Some(propertyProto.stringListValue)
    )

  def toProtoMultiple(propertiesOpt: Option[Seq[MetadataEntry]]): Seq[MetadataEntryProto] =
    propertiesOpt.map(_.map(_.toProto)).getOrElse(Seq.empty)

  def deduplicate(propertiesOpt: Option[Seq[MetadataEntry]]): Option[Seq[MetadataEntry]] =
    propertiesOpt.map(properties => properties.distinctBy(_.key))

  implicit val jsonFormat: OFormat[MetadataEntry] =
    Json.using[WithDefaultValues].format[MetadataEntry]
}
