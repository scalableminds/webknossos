package com.scalableminds.brainflight.lib

/**
 * Created by IntelliJ IDEA.
 * User: tombocklisch
 * Date: 30.10.11
 * Time: 18:43
 * To change this template use File | Settings | File Templates.
 */


import org.eclipse.jetty.server.Server
import org.eclipse.jetty.webapp.WebAppContext

import junit.framework.AssertionFailedError
import net.liftweb.common.Box
import java.net.URL
import org.eclipse.jetty.servlet.FilterHolder

final class JettyTestServer(baseUrlBox: Box[URL]) {

  def baseUrl = baseUrlBox getOrElse new URL("http://127.0.0.1:8080")

  private val (server_, context_) = {
    val server = new Server(baseUrl.getPort)
    val context = new WebAppContext()
    context.setServer(server)
    context.setContextPath("/")
    val dir = System.getProperty("net.liftweb.webapptest.src.test.webapp", "src/main/webapp")
    context.setWar(dir)
    context.addFilter(new FilterHolder(new org.eclipse.jetty.servlets.GzipFilter()),"/",1)
    server.setHandler(context)
    server.setGracefulShutdown(100)
    server.setStopAtShutdown(true)
    (server, context)
  }

  def urlFor(path: String) = baseUrl + path

  def start() {
    server_.start()
  }

  def stop() {
    context_.setShutdown(true)
    server_.stop()
    server_.join()
  }

  def running = server_.isRunning

}