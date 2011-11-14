package com.scalableminds.brainflight
package snippet

import scala.xml.NodeSeq

import net.liftweb._
import util.Props

object ProductionOnly {
  def render(in: NodeSeq): NodeSeq =
    if (Props.productionMode) in
    else NodeSeq.Empty
}