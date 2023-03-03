package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, DatasetHeader, FileSystemStore, ChunkTyper}

object PrecomputedChunkReader {
  def create(store: FileSystemStore, header: DatasetHeader): ChunkReader =
    new PrecomputedChunkReader(header, store, ChunkReader.createChunkTyper(header))
}

class PrecomputedChunkReader(header: DatasetHeader, store: FileSystemStore, typedChunkReader: ChunkTyper)
    extends ChunkReader(header, store, typedChunkReader) {}
