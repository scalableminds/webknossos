package com.scalableminds.util.rpc

import java.util.concurrent.atomic.AtomicInteger

object RPC {

  private val requestCounter: AtomicInteger = new AtomicInteger()

  def apply(url: String): RPCRequest = {
    new RPCRequest(requestCounter.getAndIncrement(), url)
  }
}
