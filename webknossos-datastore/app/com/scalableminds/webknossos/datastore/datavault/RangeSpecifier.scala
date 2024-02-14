package com.scalableminds.webknossos.datastore.datavault

import scala.collection.immutable.NumericRange

trait RangeSpecifier

case class StartEnd(range: NumericRange[Long]) extends RangeSpecifier
case class SuffixLength(length: Int) extends RangeSpecifier
case class Complete() extends RangeSpecifier

object RangeSpecifier {
  def fromRangeOpt(rangeOpt: Option[NumericRange[Long]]): RangeSpecifier =
    rangeOpt match {
      case Some(r)    => StartEnd(r)
      case scala.None => Complete()
    }
}
