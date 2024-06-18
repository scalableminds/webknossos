package com.scalableminds.webknossos.datastore.models

import com.scalableminds.util.enumeration.ExtendedEnumeration
import play.api.libs.json.{Format, JsError, JsPath, JsResult, JsString, JsSuccess, JsValue, JsonValidationError}

object LengthUnit extends ExtendedEnumeration {
  type LengthUnit = Value
  val yoctometer, zeptometer, attometer, femtometer, picometer, nanometer, micrometer, millimeter, centimeter,
  decimeter, meter, hectometer, kilometer, megameter, gigameter, terameter, petameter, exameter, zettameter, yottameter,
  angstrom, inch, foot, yard, mile, parsec = Value

  override def fromString(s: String): Option[Value] =
    s match {
      case "ym" | "yoctometer" => Some(yoctometer)
      case "zm" | "zeptometer" => Some(zeptometer)
      case "am" | "attometer"  => Some(attometer)
      case "fm" | "femtometer" => Some(femtometer)
      case "pm" | "picometer"  => Some(picometer)
      case "nm" | "nanometer"  => Some(nanometer)
      case "µm" | "micrometer" => Some(micrometer)
      case "mm" | "millimeter" => Some(millimeter)
      case "cm" | "centimeter" => Some(centimeter)
      case "dm" | "decimeter"  => Some(decimeter)
      case "m" | "meter"       => Some(meter)
      case "hm" | "hectometer" => Some(hectometer)
      case "km" | "kilometer"  => Some(kilometer)
      case "Mm" | "megameter"  => Some(megameter)
      case "Gm" | "gigameter"  => Some(gigameter)
      case "Tm" | "terameter"  => Some(terameter)
      case "Pm" | "petameter"  => Some(petameter)
      case "Em" | "exameter"   => Some(exameter)
      case "Zm" | "zettameter" => Some(zettameter)
      case "Ym" | "yottameter" => Some(yottameter)
      case "Å" | "angstrom"    => Some(angstrom)
      case "in" | "inch"       => Some(inch)
      case "ft" | "foot"       => Some(foot)
      case "yd" | "yard"       => Some(yard)
      case "mi" | "mile"       => Some(mile)
      case "pc" | "parsec"     => Some(parsec)
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

  def toNanometer(unit: Value): Double =
    unit match {
      case LengthUnit.yoctometer => 1e-15
      case LengthUnit.zeptometer => 1e-12
      case LengthUnit.attometer  => 1e-9
      case LengthUnit.femtometer => 1e-6
      case LengthUnit.picometer  => 1e-3
      case LengthUnit.nanometer  => 1.0
      case LengthUnit.micrometer => 1e3
      case LengthUnit.millimeter => 1e6
      case LengthUnit.centimeter => 1e7
      case LengthUnit.decimeter  => 1e8
      case LengthUnit.meter      => 1e9
      case LengthUnit.hectometer => 1e11
      case LengthUnit.kilometer  => 1e12
      case LengthUnit.megameter  => 1e15
      case LengthUnit.gigameter  => 1e18
      case LengthUnit.terameter  => 1e21
      case LengthUnit.petameter  => 1e24
      case LengthUnit.exameter   => 1e27
      case LengthUnit.zettameter => 1e30
      case LengthUnit.yottameter => 1e33
      case LengthUnit.angstrom   => 0.1
      case LengthUnit.inch       => 25400000.0
      case LengthUnit.foot       => 304800000.0
      case LengthUnit.yard       => 914400000.0
      case LengthUnit.mile       => 1609344000000.0
      case LengthUnit.parsec     => 3.085677581e25
    }

}
