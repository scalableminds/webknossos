package com.scalableminds.util.tools

import com.scalableminds.util.tools.{Box, Empty, Full}

object BoxUtils {

  def bool2Box(in: Boolean): Box[Unit] = if (in) Full(()) else Empty

}
