package com.scalableminds.util.tools

import net.liftweb.common.{Box, Empty, Full}

object BoxUtils {

  def bool2Box(in: Boolean): Box[Unit] = if (in) Full(()) else Empty

}
