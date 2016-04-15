/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package frontend

import scala.concurrent.{Future, Await}
import scala.sys.process.ProcessIO

import play.api.libs.ws.WS
import play.api.test.{FakeApplication, WithServer, TestServer}
import scala.concurrent.duration._
import org.specs2.mutable._
import org.specs2.specification._
import scala.io.Source
import reactivemongo.api._
import scala.concurrent.ExecutionContext.Implicits.global
import sys.process._

class ProtractorSpec extends Specification with BeforeAll {

  val testDB = "oxalis-testing"

  def beforeAll = {
    try {
      println(s"About to drop database: $testDB")
      s"./tools/dropDB.sh $testDB".run(getProcessIO).exitValue()
      s"./tools/import_export/import.sh $testDB testdb".run(getProcessIO).exitValue()
      println("Successfully dropped the database and imported testdb")
    } catch {
      case e: Exception =>
        throw new Error(s"An exception occured while dropping the database: ${e.toString}")
    }
  }

  "my application" should {

    "pass the protractor tests" in new WithServer(app = FakeApplication(additionalConfiguration = Map("mongodb.db" -> testDB)), port = 9000) {
      val resp = Await.result(WS.url("http://localhost:9000").get(), 2 seconds)
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
      stdout => Source.fromInputStream(stdout).getLines().foreach(println),
      stderr => Source.fromInputStream(stderr).getLines().foreach(System.err.println))
  }

}
