# Web Worker Modules

This folder contains modules which can be executed in the context of web workers.
Using web workers, we can offload heavy computation from the main thread.

## Using Web Worker Modules

When using a web worker module, you need to import it and turn it into an executable function:

```js
import { createWorker } from "oxalis/workers/comlink_wrapper";
import SomeFunctionWorker from "oxalis/workers/some_function.worker";

const someFunction = createWorker(SomeFunctionWorker);

// Use it
const result = await someFunction(parameters);
```

## Writing Web Worker Modules

First, create a new file in this folder and ensure that it has the extension `*.worker.js`.
The module should export a default function (or class) which is `exposed` via [comlink](https://github.com/GoogleChromeLabs/comlink).
See `compress.worker.js` for an example.

## Caveats

- Accessing global state (e.g., the Store) is not directly possible from web workers, since they have their own execution context. Pass necessary information into web workers via parameters.
- By default, parameters and return values are either structurally cloned or transferred (if they support it) to/from the web worker. Copying is potentially performance-intensive and also won't propagate any mutations across the main-thread/webworker border. If objects are transferable (e.g., for ArrayBuffers, but not TypedArrays), they are moved to the new context, which means that they cannot be accessed in the old thread, anymore. In both cases, care has to be taken. In general, web workers should only be responsible for a very small (but cpu intensive) task with a bare minimum of dependencies.
- Not all objects can be passed between main thread and web workers (e.g., Header objects). For these cases, you have to implement and register a specific transfer handler for the object type. See `headers_transfer_handler.js` as an example.
- Web worker files can import NPM modules and also modules from within this code base, but beware that the execution context between the main thread and web workers is strictly isolated. Webpack will create a separate JS file for each web worker into which all imported code is compiled.

Learn more about the Comlink module we use [here](https://github.com/GoogleChromeLabs/comlink).
