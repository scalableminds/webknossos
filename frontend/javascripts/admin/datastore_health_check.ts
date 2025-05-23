import * as RestAPI from "admin/rest_api";
import Request from "libs/request";
import Toast from "libs/toast";
import _ from "lodash";
import messages from "messages";

// Create a throttled function which depends on its arguments.
// That way, each datastore is checked for health in a throttled and isolated manner
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'func' implicitly has an 'any' type.
const memoizedThrottle = (func, wait = 0, options = {}): ((...args: Array<any>) => any) => {
  // Memoize the creation of a throttling function
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolver' does not exist on type '{}'.
  const mem = _.memoize(() => _.throttle(func, wait, options), options.resolver);

  return (...args: Array<any>) => {
    // look up (or create) the throttling function and invoke it
    // @ts-expect-error ts-migrate(2556) FIXME: Expected 0 arguments, but got 1 or more.
    mem(...args)(...args);
  };
};

// Do not call this function directly, but call pingMentionedDataStores instead
// which will take care of extracting the hostnames.
// Otherwise, the memoization will not work correctly if the path and query-string are part of the URL
const pingDataStoreIfAppropriate = memoizedThrottle(async (requestedUrl: string): Promise<any> => {
  const [datastores, tracingstore, isInMaintenance] = await Promise.all([
    RestAPI.getDataStoresCached(),
    RestAPI.getTracingStoreCached(),
    RestAPI.isInMaintenance(),
  ]).catch(() => [null, null, null]);

  if (datastores == null || tracingstore == null || isInMaintenance == null) {
    Toast.warning(messages.offline);
    return;
  }

  const stores = [
    { ...tracingstore, path: "tracings" },
    ...datastores.map((datastore) => ({ ...datastore, path: "data" })),
  ];

  if (isInMaintenance) {
    Toast.warning(messages.planned_maintenance);
  } else {
    const usedStore = stores.find((ds) => requestedUrl.indexOf(ds.url) > -1);

    if (usedStore != null) {
      const { url, path } = usedStore;
      const healthEndpoint = `${url}/${path}/health`;
      Request.triggerRequest(healthEndpoint, {
        doNotInvestigate: true,
        mode: "cors",
        timeout: 5000,
      }).then(
        () => checkVersionMismatch(url),
        () =>
          Toast.warning(
            messages["datastore.health"]({
              url,
            }),
          ),
      );
    }
  }
}, 5000);

async function checkVersionMismatch(url: string) {
  const [buildinfoWebknossos, buildinfoDatastore] = await Promise.all([
    RestAPI.getBuildInfo(),
    RestAPI.getDataStoreBuildInfo(url),
  ]);
  const expectedDatastoreApiVersion = buildinfoWebknossos.webknossos.datastoreApiVersion;
  const buildInfoWebknossosDatastore = buildinfoDatastore.webknossosDatastore
    ? buildinfoDatastore.webknossosDatastore
    : buildinfoDatastore.webknossos;
  const suppliedDatastoreApiVersion = buildInfoWebknossosDatastore.datastoreApiVersion;

  if (
    Number(expectedDatastoreApiVersion.split(".")[0]) <
    Number(suppliedDatastoreApiVersion.split(".")[0])
  ) {
    Toast.warning(
      messages["datastore.version.too_new"]({
        expectedDatastoreApiVersion,
        suppliedDatastoreApiVersion,
        url,
      }),
    );
  } else if (
    Number(expectedDatastoreApiVersion.split(".")[0]) >
    Number(suppliedDatastoreApiVersion.split(".")[0])
  ) {
    Toast.warning(
      messages["datastore.version.too_old"]({
        expectedDatastoreApiVersion,
        suppliedDatastoreApiVersion,
        url,
      }),
    );
  }
}

const extractUrls = (str: string): Array<string> => {
  const urlMatcher =
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}(\.[a-z]{2,6})?\b([-a-zA-Z0-9@:%_+.~#?&\\=]*)/g;
  return _.uniq(str.match(urlMatcher) || []);
};

export const pingMentionedDataStores = (str: string): void => {
  extractUrls(str).map(pingDataStoreIfAppropriate);
};
export default {};
