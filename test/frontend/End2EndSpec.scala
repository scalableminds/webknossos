/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package frontend

import scala.concurrent.{Await, Future}
import scala.sys.process.ProcessIO

import play.api.libs.ws.WS
import play.api.test.{FakeApplication, TestServer, WithServer}
import scala.concurrent.duration._

import org.specs2.main.Arguments
import org.specs2.mutable._
import org.specs2.specification._
import scala.io.Source

import reactivemongo.api._
import play.api.libs.concurrent.Execution.Implicits._
import sys.process._

import com.typesafe.scalalogging.LazyLogging

class End2EndSpec(arguments: Arguments) extends Specification with LazyLogging {

  val argumentMapRead = parseCustomJavaArgs(arguments)
  val mongoUri  = argumentMapRead.getOrElse("mongodb.uri", "mongodb://localhost:27017/webknossos-testing")
  val testPort = 9000
  val argumentMap = argumentMapRead +
                 ("mongodb.uri"  -> mongoUri,
                  "http.port"    -> testPort,
                  "play.modules.disabled" -> List("com.scalableminds.webknossos.datastore.DataStoreModule"),
                  "play.http.router" -> "webknossos.Routes",
                  "datastore.enabled" -> false)

  "my application" should {

    "pass the e2e tests" in new WithServer(
      app = FakeApplication(
        additionalConfiguration = argumentMap
      ),
      port = testPort) {

      val resp = Await.result(WS.url(s"http://localhost:$testPort").get(), 2 seconds)
      resp.status === 200

      runWebdriverTests === 0
    }

  }

  private def runWebdriverTests: Int = {
    val result = "yarn test-e2e".run().exitValue()
    result
  }

  private def parseCustomJavaArgs(arguments: Arguments) = {
    val argumentsString = arguments.commandLine.arguments
    val customArgumentsMap = argumentsString.filter(_.startsWith("-D")).map(_.split("="))
    customArgumentsMap.groupBy(_(0).substring(2)).mapValues(_(0).last)
  }

}
