package models

import akka.actor._
import play.api.libs.concurrent._
import play.api.Play.current
import brainflight.mail.Mailer

object Actors {
  val Mailer = Akka.system.actorOf( Props[Mailer] )
}