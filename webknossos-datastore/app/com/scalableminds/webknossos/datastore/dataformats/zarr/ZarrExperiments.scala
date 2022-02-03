package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.bc.zarr.{ZarrArray, ArrayParams, DataType}


class ZarrExperiments {
  ZarrArray.create(new ArrayParams()
    .shape(10000, 10000)
    .chunks(1000, 1000)
    .dataType(DataType.i4)
  );
}
