// @flow
import messages from "messages";
// We can't import getDataStoresCached directly since this is a cyclic reference.
// The access only works because it is lazy and wrapped by the RestAPI object
import * as RestAPI from "admin/admin_rest_api";
import Request from "libs/request";
import Toast from "libs/toast";
import _ from "lodash";

// Create a throttled function which depends on its arguments.
// That way, each datastore is checked for health in a throttled and isolated manner
const memoizedThrottle = (func, wait = 0, options = {}): Function => {
  // Memoize the creation of a throttling function
  const mem = _.memoize(() => _.throttle(func, wait, options), options.resolver);
  return (...args: Array<*>) => {
    // look up (or create) the throttling function and invoke it
    mem(...args)(...args);
  };
};

export const pingDataStoreIfAppropriate = memoizedThrottle(async (requestedUrl: string): Promise<
  *,
> => {
  const [datastores, tracingstore, isInMaintenance] = await Promise.all([
    RestAPI.getDataStoresCached(),
    RestAPI.getTracingStoreCached(),
    RestAPI.isInMaintenance(),
  ]);
  const stores = datastores.concat(tracingstore);
  if (isInMaintenance) {
    Toast.warning(messages.planned_maintenance);
  } else {
    const usedDataStore = stores.find(ds => requestedUrl.indexOf(ds.url) > -1);
    if (usedDataStore != null) {
      const { url } = usedDataStore;
      const healthEndpoint = `${url}/data/health`;
      Request.triggerRequest(healthEndpoint, {
        doNotInvestigate: true,
        mode: "cors",
        timeout: 5000,
      }).then(
        () => checkVersionMismatch(url),
        () => Toast.warning(messages["datastore.health"]({ url })),
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
  const urlMatcher = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}(\.[a-z]{2,6})?\b([-a-zA-Z0-9@:%_+.~#?&\\=]*)/g;
  return _.uniq(str.match(urlMatcher) || []);
};

export const pingMentionedDataStores = (str: string): void => {
  extractUrls(str).map(pingDataStoreIfAppropriate);
};
