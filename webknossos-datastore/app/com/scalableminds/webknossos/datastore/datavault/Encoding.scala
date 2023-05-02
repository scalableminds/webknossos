package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.enumeration.ExtendedEnumeration

object Encoding extends ExtendedEnumeration {
  type Encoding = Value
  val gzip, brotli, none, unsupported = Value

  // Header defined in https://datatracker.ietf.org/doc/html/rfc7231#section-3.1.2.2,
  // List of possible entries: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding
  def fromRfc7231String(s: String): Encoding =
    s match {
      case "gzip" => gzip
      case "br"   => brotli
      case ""     => none
      case _      => unsupported
    }
}
