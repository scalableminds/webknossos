package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.tools.{Box, Failure, Full}

// Lists the encodings supported by VaultPath.readBytes
object Encoding extends ExtendedEnumeration {
  type Encoding = Value
  val gzip, brotli, identity = Value

  // Header defined in https://datatracker.ietf.org/doc/html/rfc7231#section-3.1.2.2
  // List of possible entries: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding
  def fromRfc7231String(s: String): Box[Encoding] =
    s match {
      case "gzip"     => Full(gzip)
      case "x-gzip"   => Full(gzip)
      case "br"       => Full(brotli)
      case "identity" => Full(identity)
      case ""         => Full(identity)
      case _          => Failure(s"Unsupported encoding: $s")
    }
}
