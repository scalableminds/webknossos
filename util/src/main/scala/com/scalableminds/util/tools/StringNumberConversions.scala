package com.scalableminds.util.tools

import com.scalableminds.util.box.Box.tryo

object StringNumberConversions {
  extension (s: String) {
    def toFloatOpt: Option[Float] = tryo(s.toFloat).toOption
    def toDoubleOpt: Option[Double] = tryo(s.toDouble).toOption
    def toIntOpt: Option[Int] = tryo(s.toInt).toOption
    def toLongOpt: Option[Long] = tryo(s.toLong).toOption
    def toBooleanOpt: Option[Boolean] = tryo(s.toBoolean).toOption
  }
}
