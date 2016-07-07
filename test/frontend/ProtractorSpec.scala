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

class ProtractorSpec(arguments: Arguments) extends Specification with BeforeAll with LazyLogging {

  val argumentMapRead = parseCustomJavaArgs(arguments)
  val mongoDb   = argumentMapRead.getOrElse("mongodb.db", "oxalis-testing")
  val mongoHost = argumentMapRead.getOrElse("mongodb.url", "localhost")
  val mongoPort = argumentMapRead.getOrElse("mongodb.port", "27017")
  val testPort = 9000
  val argumentMap = argumentMapRead +
                 ("mongodb.db"   -> mongoDb,
                  "mongodb.url"  -> mongoHost,
                  "mongodb.port" -> mongoPort,
                  "http.port"    -> testPort,
                  "mongodb.evolution.mongoCmd" -> s"mongo $mongoHost:$mongoPort/$mongoDb")

  def beforeAll = {
    try {
      logger.warn(s"About to drop database: $mongoDb")
      s"./tools/dropDB.sh $mongoDb $mongoHost $mongoPort".run(getProcessIO).exitValue()
      s"./tools/import_export/import.sh $mongoDb testdb $mongoHost $mongoPort".run(getProcessIO).exitValue()
      logger.info("Successfully dropped the database and imported testdb")
    } catch {
      case e: Exception =>
        throw new Error(s"An exception occured while dropping the database: ${e.toString}")
    }
  }

  "my application" should {

    "pass the protractor e2e tests" in new WithServer(
      app = FakeApplication(additionalConfiguration = argumentMap),
      port = testPort) {

      val resp = Await.result(WS.url(s"http://localhost:$testPort").get(), 2 seconds)
      resp.status === 200

      runProtractorTests === 0
    }

  }

  private def runProtractorTests: Int = {
    val webdriver = "npm run webdriver".run(getProcessIO)
    Thread.sleep(5000)
    val result = "./node_modules/.bin/protractor".run(getProcessIO).exitValue()
    webdriver.destroy()
    result
  }

  private def getProcessIO: ProcessIO = {
    new ProcessIO(_ => (),
      stdout => Source.fromInputStream(stdout).getLines().foreach(l => logger.info(l)),
      stderr => Source.fromInputStream(stderr).getLines().foreach(l => logger.error(l)))
  }

  private def parseCustomJavaArgs(arguments: Arguments) = {
    val argumentsString = arguments.commandLine.arguments
    val customArgumentsMap = argumentsString.filter(_.startsWith("-D")).map(_.split("="))
    customArgumentsMap.groupBy(_(0).substring(2)).mapValues(_(0).last)
  }

}
