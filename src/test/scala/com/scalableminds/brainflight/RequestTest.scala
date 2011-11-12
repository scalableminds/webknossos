package com.scalableminds.brainflight


import lib.JettyTestServer
import net.liftweb._
import common.{Box, Full}
import util._
import http._
import testing._
import Helpers._

import java.net.{URL, InetAddress}
import scala.Option._
import org.eclipse.jetty.servlets.GzipFilter
import org.eclipse.jetty.servlet.FilterHolder
import org.specs2.mutable.Specification
import org.specs2.matcher.MatchFailure

/**
 * Scalable Minds - Brainflight
 * User: tmbo
 * Date: 10/14/11
 * Time: 5:56 AM
 */


object RequestTest extends Specification with TestKit{
  // don't run those tests parallel
  sequential
  // stop jetty flooding the console window
  org.eclipse.jetty.util.log.Log.setLog(new JavaSilentLogger)

  private val host_ = reachableLocalAddress
  private val port_ = 8181

  private lazy val baseUrl_ = new URL("http://%s:%s".format(host_, port_))

  private lazy val jetty = new JettyTestServer(Full(baseUrl_))

  def baseUrl = jetty.baseUrl.toString

  step{
    jetty.start()
  }

  "JettyServer" should {
    "always return 200" in {
        val sites = List("/static/index",
                         "/",
                         "/data/cube?px=0&py=0&pz=0&ax=0&ay=1&az=0",
                         "/model/cube"
                        )
          for {
            url <- sites
            resp <- get(url) !@ ("Failed to load "+url) if(testSuccess(resp))
          }{ }
      ok
    }
  }

  step {
    tryo {
      jetty.stop()
    }
  }

  implicit val reportError = new ReportFailure {
    def fail(msg: String) = RequestTest.failure(msg)
  }

  private def reachableLocalAddress = {
    val l = InetAddress.getLocalHost
    tryo { l.isReachable(50) } match {
      case Full(true) => l.getHostAddress
      case _          => "127.0.0.1"
    }
  }
  private def testSuccess(resp: Response) {
    resp match {
      case resp: HttpResponse =>
        resp.code must_== 200
      case _ => ko("Not an HTTP Response")
    }
  }
}
