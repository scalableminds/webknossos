package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, DatasetHeader, FileSystemStore, TypedChunkReader}

object PrecomputedChunkReader {
  def create(store: FileSystemStore, header: DatasetHeader): ChunkReader =
    new PrecomputedChunkReader(header, store, ChunkReader.createTypedChunkReader(header))
}

class PrecomputedChunkReader(header: DatasetHeader, store: FileSystemStore, typedChunkReader: TypedChunkReader)
  extends ChunkReader(header, store, typedChunkReader){
  // TODO
}
