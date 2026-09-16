# Browser IndexedDB Example (07-browser-indexeddb)

Demonstrates how to run **EVMEventLake** natively in browser dApps (React, Vue, Vite, or vanilla HTML/TS) using the **IndexedDB** storage adapter.

---

## Key Features Demonstrated

1. **Zero Native C++ Bindings**:
   No `better-sqlite3` or `pg` dependencies are imported into the browser bundle.

2. **Identical Isomorphic API**:
   The exact same methods used in Node.js backend services are used in frontend dApps:
   - `EVMEventLake.create({ database: "idb://base-usdc-lake", ... })`
   - `lake.getSyncStatus()`
   - `lake.update({ toBlock: ... })`
   - `lake.events.findMany({ where: { ... } })`
   - `lake.close()`

3. **Offline Event Cache**:
   After synchronization, `lake.events.findMany()` queries IndexedDB entirely client-side without any RPC network overhead.

---

## How to Run

From the project root:

```bash
cd examples/07-browser-indexeddb
pnpm install
pnpm run dev
```

Open your browser at `http://localhost:5173`.
