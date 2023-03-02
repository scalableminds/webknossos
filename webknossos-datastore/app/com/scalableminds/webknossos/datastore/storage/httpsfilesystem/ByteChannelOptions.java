package com.scalableminds.webknossos.datastore.storage.httpsfilesystem;

import java.nio.file.OpenOption;

public enum ByteChannelOptions implements OpenOption {
  RANGE;

  ByteChannelOptions() {
  }
}
