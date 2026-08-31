package com.scalableminds.util.tools

import play.api.libs.json.{Json, OFormat}

/** Derives a Play JSON `OFormat` for a case class, replacing the boilerplate companion object that
  * otherwise only exists to hold `implicit val jsonFormat: OFormat[X] = Json.format[X]`.
  *
  * Usage: `case class Foo(...) derives AutoFormat`
  *
  * Only for the plain case. A case class needing a non-default `JsonConfiguration` (e.g. tristate
  * options, see [[TristateOptionJsonHelper]]) or custom Reads/Writes should keep using an explicit
  * companion object instead, so that all its JSON formatting logic lives in one obvious place rather
  * than being split between `derives` on the class and configuration hidden in the companion.
  */
trait AutoFormat[A] extends OFormat[A]

object AutoFormat {
  inline def derived[A]: AutoFormat[A] = {
    val underlying = Json.format[A]
    new AutoFormat[A] {
      export underlying.{reads, writes}
    }
  }
}
