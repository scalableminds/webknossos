package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.webknossos.datastore.datareaders.{ChunkReader, ChunkTyper, DatasetHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath

object PrecomputedChunkReader {
  def create(vaultPath: VaultPath, header: DatasetHeader): ChunkReader =
    new PrecomputedChunkReader(header, vaultPath, ChunkReader.createChunkTyper(header))
}

class PrecomputedChunkReader(header: DatasetHeader, vaultPath: VaultPath, typedChunkReader: ChunkTyper)
    extends ChunkReader(header, vaultPath, typedChunkReader) {}
