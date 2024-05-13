package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.enumeration.ExtendedEnumeration
import play.api.libs.json.{Format, JsError, JsPath, JsResult, JsString, JsSuccess, JsValue, JsonValidationError}

object LengthUnit extends ExtendedEnumeration {
  type LengthUnit = Value
  val ym, zm, am, fm, pm, nm, µm, mm, cm, dm, m, hm, km, Mm, Gm, Tm, Pm, Em, Zm, Ym, Å, in, ft, yd, mi, pc = Value

  override def fromString(s: String): Option[Value] =
    s match {
      case "ym" | "yoctometer" => Some(ym)
      case "zm" | "zeptometer" => Some(zm)
      case "am" | "attometer"  => Some(am)
      case "fm" | "femtometer" => Some(fm)
      case "pm" | "picometer"  => Some(pm)
      case "nm" | "nanometer"  => Some(nm)
      case "µm" | "micrometer" => Some(µm)
      case "mm" | "millimeter" => Some(mm)
      case "cm" | "centimeter" => Some(cm)
      case "dm" | "decimeter"  => Some(dm)
      case "m" | "meter"       => Some(m)
      case "hm" | "hectometer" => Some(hm)
      case "km" | "kilometer"  => Some(km)
      case "Mm" | "megameter"  => Some(Mm)
      case "Gm" | "gigameter"  => Some(Gm)
      case "Tm" | "terameter"  => Some(Tm)
      case "Pm" | "petameter"  => Some(Pm)
      case "Em" | "exameter"   => Some(Em)
      case "Zm" | "zettameter" => Some(Zm)
      case "Ym" | "yottameter" => Some(Ym)
      case "Å" | "angstrom"    => Some(Å)
      case "in" | "inch"       => Some(in)
      case "ft" | "foot"       => Some(ft)
      case "yd" | "yard"       => Some(yd)
      case "mi" | "mile"       => Some(mi)
      case "pc" | "parsec"     => Some(pc)
      case _                   => None
    }

  implicit override val format: Format[Value] = new Format[Value] {
    def reads(json: JsValue): JsResult[Value] =
      json.validate[String].flatMap { asString =>
        fromString(asString)
          .map(JsSuccess(_))
          .getOrElse(JsError(Seq(JsPath -> Seq(JsonValidationError("error.expected.validenumvalue")))))
      }

    def writes(value: Value): JsValue = JsString(value.toString)
  }
}
