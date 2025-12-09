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

  // TODOM: The advantage of this implementation: Only one of the optional fields is set
  // Disadvantage: wordiness. Discuss which option to choose
  def update(that: MetadataEntry): MetadataEntry =
    if (this.key != that.key) {
      this
    } else {
      that match {
        case m if m.stringValue.isDefined =>
          this.copy(
            stringValue = m.stringValue,
            boolValue = None,
            numberValue = None,
            stringListValue = None,
          )
        case m if m.boolValue.isDefined =>
          this.copy(
            stringValue = None,
            boolValue = m.boolValue,
            numberValue = None,
            stringListValue = None,
          )
        case m if m.numberValue.isDefined =>
          this.copy(
            stringValue = None,
            boolValue = None,
            numberValue = m.numberValue,
            stringListValue = None,
          )
        case m if m.stringListValue.isDefined =>
          this.copy(
            stringValue = None,
            boolValue = None,
            numberValue = None,
            stringListValue = m.stringListValue,
          )
        case _ => this
      }
    }

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
