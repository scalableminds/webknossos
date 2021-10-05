# FAQ

## Newly Registered Users Don't Show Up

Please go to the User list screen in the admin section.
Deactivate the `Show Active Users Only` option above the User table.

## How Can I Use My Dataset With webKnossos

webKnossos supports WKW and KNOSSOS datasets.
Other formats can be converted using the [webKnossos Cuber](https://github.com/scalableminds/webknossos-cuber) tool.

## Can I Host the webKnossos Data in My Own Compute Cluster

webKnossos consists of two components that allow for versatile deployment options:
1. The webKnossos main component handles user and task management.
2. The datastore component serves data requests and stores skeleton and volume annotations.

By default, the datastore is integrated into the main component.
Multiple datastores may be connected to a single webKnossos instance.
Both components need to be publicly accessible via the Internet.

For example, the webKnossos main component could be hosted on commercial cloud infrastructure whereas the datastore is hosted directly in your lab's cluster hardware.

[scalable minds](https://scalableminds.com) offers commercial support and managed hosting for custom deployment options.

## Can I further analyze my annotations outside of webKnossos with Python/MATLAB?
Yes, you can. webKnossos allows the download and export of skeleton annotations as NML files and segmentations/volume data as binary/wkw files.

See the [Tooling](./tooling.md) section for a recommendation of Python/MATLAB libraries to work with the webKnossos standard formats.
