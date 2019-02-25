package com.scalableminds.webknossos.datastore.rpc

import java.util.concurrent.atomic.AtomicInteger

import javax.inject.Inject
import play.api.libs.ws.WSClient

class RPC @Inject()(ws: WSClient) {

  private val requestCounter: AtomicInteger = new AtomicInteger()

  def apply(url: String): RPCRequest =
    new RPCRequest(requestCounter.getAndIncrement(), url, ws)

}
