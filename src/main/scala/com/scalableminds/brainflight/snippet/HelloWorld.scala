package com.scalableminds.brainflight
package snippet

import com.scalableminds.brainflight.lib._

import java.util.Date
import scala.xml.{NodeSeq, Text}

import net.liftweb._
import common._
import util._
import Helpers._

class HelloWorld {
  lazy val date: Box[Date] = DependencyFactory.inject[Date] // inject the date

  // replace the contents of the element with id "time" with the date
  def render = "#time *" #> date.map(_.toString)

  /*
   lazy val date: Date = DependencyFactory.time.vend // create the date via factory

   def howdy = "#time *" #> date.toString
   */
}
