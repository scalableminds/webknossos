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

  def toNanometer(unit: Value): Double =
    unit match {
      case LengthUnit.ym => 1e-15
      case LengthUnit.zm => 1e-12
      case LengthUnit.am => 1e-9
      case LengthUnit.fm => 1e-6
      case LengthUnit.pm => 1e-3
      case LengthUnit.nm => 1.0
      case LengthUnit.µm => 1e3
      case LengthUnit.mm => 1e6
      case LengthUnit.cm => 1e7
      case LengthUnit.dm => 1e8
      case LengthUnit.m  => 1e9
      case LengthUnit.hm => 1e11
      case LengthUnit.km => 1e12
      case LengthUnit.Mm => 1e15
      case LengthUnit.Gm => 1e18
      case LengthUnit.Tm => 1e21
      case LengthUnit.Pm => 1e24
      case LengthUnit.Em => 1e27
      case LengthUnit.Zm => 1e30
      case LengthUnit.Ym => 1e33
      case LengthUnit.Å  => 0.1
      case LengthUnit.in => 25400000.0
      case LengthUnit.ft => 304800000.0
      case LengthUnit.yd => 914400000.0
      case LengthUnit.mi => 1609344000000.0
      case LengthUnit.pc => 3.085677581e25
    }

  def toNgffString(unit: Value): String =
    unit match {
      case LengthUnit.ym => "yoctometer"
      case LengthUnit.zm => "zeptometer"
      case LengthUnit.am => "attometer"
      case LengthUnit.fm => "femtometer"
      case LengthUnit.pm => "picometer"
      case LengthUnit.nm => "nanometer"
      case LengthUnit.µm => "micrometer"
      case LengthUnit.mm => "millimeter"
      case LengthUnit.cm => "centimeter"
      case LengthUnit.dm => "decimeter"
      case LengthUnit.m  => "meter"
      case LengthUnit.hm => "hectometer"
      case LengthUnit.km => "kilometer"
      case LengthUnit.Mm => "megameter"
      case LengthUnit.Gm => "gigameter"
      case LengthUnit.Tm => "terameter"
      case LengthUnit.Pm => "petameter"
      case LengthUnit.Em => "exameter"
      case LengthUnit.Zm => "zettameter"
      case LengthUnit.Ym => "yottameter"
      case LengthUnit.Å  => "angstrom"
      case LengthUnit.in => "inch"
      case LengthUnit.ft => "foot"
      case LengthUnit.yd => "yard"
      case LengthUnit.mi => "mile"
      case LengthUnit.pc => "parsec"
    }
}
