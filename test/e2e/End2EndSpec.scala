package e2e

import com.typesafe.scalalogging.LazyLogging
import org.scalatestplus.play.guice._
import org.specs2.main.Arguments
import org.specs2.mutable._
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.libs.ws.WSClient
import play.api.test.WithServer

import scala.concurrent.Await
import scala.concurrent.duration._
import scala.sys.process._

class End2EndSpec (arguments: Arguments) extends Specification with GuiceFakeApplicationFactory with LazyLogging {

  val argumentMapRead = parseCustomJavaArgs(arguments)
  val testPort = 9000
  val argumentMap = argumentMapRead +
                 ("http.port"    -> testPort)

  val application = new GuiceApplicationBuilder().configure(argumentMap).build()

  val ws: WSClient = application.injector.instanceOf[WSClient]

  "my application" should {

    "pass the e2e tests" in new WithServer(
      app = application,
      port = testPort) {

      val resp = Await.result(ws.url(s"http://localhost:$testPort").get(), 2 seconds)
      resp.status === 200

      runWebdriverTests === 0
    }

  }

  private def runWebdriverTests = "yarn test-e2e -C 1".run().exitValue()

  private def parseCustomJavaArgs(arguments: Arguments) = {
    val argumentsString = arguments.commandLine.arguments
    val customArgumentsMap = argumentsString.filter(_.startsWith("-D")).map(_.split("="))
    customArgumentsMap.groupBy(_(0).substring(2)).mapValues(_(0).last)
  }

}
