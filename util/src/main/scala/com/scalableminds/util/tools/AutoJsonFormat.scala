package com.scalableminds.util.tools

import play.api.libs.json.{Json, OFormat}

trait AutoJsonFormat[A] extends OFormat[A]

final private class AutoJsonFormatImpl[A](underlying: OFormat[A]) extends AutoJsonFormat[A] {
  export underlying.{reads, writes}
}

object AutoJsonFormat {
  inline def derived[A]: AutoJsonFormat[A] = new AutoJsonFormatImpl[A](Json.format[A])
}
