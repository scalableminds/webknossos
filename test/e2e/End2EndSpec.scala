package e2e

import scala.concurrent.{Await, Future}
import scala.sys.process.ProcessIO
import play.api.libs.ws.{WSClient}
import play.api.test.WithServer

import org.scalatestplus.play.guice._
import scala.concurrent.duration._
import org.specs2.main.Arguments
import org.specs2.mutable._

import sys.process._
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject

class End2EndSpec @Inject()(ws: WSClient)(arguments: Arguments) extends Specification with GuiceFakeApplicationFactory with LazyLogging {

  val argumentMapRead = parseCustomJavaArgs(arguments)
  val testPort = 9000
  val argumentMap = argumentMapRead +
                 ("http.port"    -> testPort)

  "my application" should {

    "pass the e2e tests" in new WithServer(
      app = fakeApplication().withinargumentMap),
      port = testPort) {

      val resp = Await.result(ws.url(s"http://localhost:$testPort").get(), 2 seconds)
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
