/**
  * Copyright 2011 Tim Nelson
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *     http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  */

package net.liftmodules.mongoauth

import org.joda.time.{Days, Hours, ReadablePeriod}

import net.liftweb._
import common._
import http.{Factory, SessionVar, S}
import sitemap.{LocPath, Menu}
import util.Helpers

object MongoAuth extends Factory {
  // AuthUserMeta object
  val authUserMeta = new FactoryMaker[AuthUserMeta[_]](model.SimpleUser) {}

  // urls
  val indexUrl = new FactoryMaker[String]("/") {}
  val loginUrl = new FactoryMaker[String]("/login") {}
  val logoutUrl = new FactoryMaker[String]("/logout") {}

  // site settings
  val siteName = new FactoryMaker[String]("Example") {}
  val systemEmail = new FactoryMaker[String]("info@example.com") {}
  val systemUsername = new FactoryMaker[String]("Example Staff") {}

  def systemFancyEmail = AuthUtil.fancyEmail(systemUsername.vend, systemEmail.vend)

  // LoginToken
  val loginTokenUrl = new FactoryMaker[String]("/login-token") {}
  val loginTokenAfterUrl = new FactoryMaker[String]("/set-password") {}
  val loginTokenExpires = new FactoryMaker[ReadablePeriod](Hours.hours(48)) {}

  // ExtSession
  val extSessionExpires = new FactoryMaker[ReadablePeriod](Days.days(90)) {}
  val extSessionCookieName = new FactoryMaker[String]("EXTSESSID") {}
  val extSessionCookiePath = new FactoryMaker[String]("/") {}

  // Permission
  val permissionWilcardToken = new FactoryMaker[String]("*") {}
  val permissionPartDivider = new FactoryMaker[String](":") {}
  val permissionSubpartDivider = new FactoryMaker[String](",") {}
  //val permissionCaseSensitive = new FactoryMaker[Boolean](true) {}
}

object AuthUtil {
  def tryo[T](f: => T): Box[T] = {
    try {
      f match {
        case null => Empty
        case x => Full(x)
      }
    } catch {
      case e => Failure(e.getMessage, Full(e), Empty)
    }
  }

  def fancyEmail(name: String, email: String): String = "%s <%s>".format(name, email)
}

/*
 * User gets sent here after a successful login.
 */
object LoginRedirect extends SessionVar[Box[String]](Empty) {
  override def __nameSalt = Helpers.nextFuncName
}