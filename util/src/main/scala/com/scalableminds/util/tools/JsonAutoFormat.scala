package com.scalableminds.util.tools

import play.api.libs.json.{Json, OFormat}

trait JsonAutoFormat[A] extends OFormat[A]

final private class JsonAutoFormatImpl[A](underlying: OFormat[A]) extends JsonAutoFormat[A] {
  export underlying.{reads, writes}
}

object JsonAutoFormat {
  inline def derived[A]: JsonAutoFormat[A] = new JsonAutoFormatImpl[A](Json.format[A])
}
