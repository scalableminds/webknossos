package com.scalableminds.webknossos.datastore.datareaders

/** How chunk reads of a sharded array are combined into requests.
  *
  * @param maxGapBytes
  *   Neighboring chunks of a shard are read with one request if the bytes between them are at most this many. A
  *   negative value reads every chunk with its own request.
  * @param maxRequestBytes
  *   Combined requests are not extended beyond this size.
  * @param maxParallelRequests
  *   Maximum number of requests in flight at the same time.
  */
case class ChunkReadCoalescing(maxGapBytes: Long, maxRequestBytes: Long, maxParallelRequests: Int) {
  def isEnabled: Boolean = maxGapBytes >= 0
}

object ChunkReadCoalescing {

  // A chunk's byte range within its shard, together with the caller's index for it.
  case class ChunkByteRange(key: Int, start: Long, endExclusive: Long)

  case class CoalescedRequest(start: Long, endExclusive: Long, chunks: Seq[ChunkByteRange])

  /** Groups the byte ranges of chunks within one shard into requests. Chunks are sorted by their start, and a chunk
    * joins the current request if the gap to it is at most maxGapBytes and the request stays within maxRequestBytes.
    */
  def coalesce(chunks: Seq[ChunkByteRange], coalescing: ChunkReadCoalescing): Seq[CoalescedRequest] = {
    val sorted = chunks.sortBy(_.start)
    if (!coalescing.isEnabled) {
      sorted.map(chunk => CoalescedRequest(chunk.start, chunk.endExclusive, Vector(chunk)))
    } else {
      val requests = Seq.newBuilder[CoalescedRequest]
      var current: Option[CoalescedRequest] = None
      sorted.foreach { chunk =>
        current match {
          case Some(request)
              if chunk.start - request.endExclusive <= coalescing.maxGapBytes &&
                Math.max(request.endExclusive, chunk.endExclusive) - request.start <= coalescing.maxRequestBytes =>
            current = Some(
              CoalescedRequest(
                request.start,
                Math.max(request.endExclusive, chunk.endExclusive),
                request.chunks :+ chunk
              )
            )
          case Some(request) =>
            requests += request
            current = Some(CoalescedRequest(chunk.start, chunk.endExclusive, Vector(chunk)))
          case None =>
            current = Some(CoalescedRequest(chunk.start, chunk.endExclusive, Vector(chunk)))
        }
      }
      current.foreach(requests += _)
      requests.result()
    }
  }
}
