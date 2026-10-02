# raven-demo-ui

```
pnpm install && pnpm dev
```

## Wire observer

`/observer` shows every request a wallet sends to its POI servers, side by side for a run with
Raven off and a run with Raven on, and marks any request that carries one of the wallet's note
commitments.

```
pnpm observer:proxy --raven <raven-node-url> --aggregator <ppoi-aggregator-url> \
  --commitments-file notes.txt
```

Point the Raven-on wallet's Raven endpoint at `http://127.0.0.1:8790/raven` and both its aggregator
and its POI node URL at `http://127.0.0.1:8791/aggregator`; point the Raven-off wallet's POI node URL
at `http://127.0.0.1:8792/aggregator`. The port a request enters on decides its pane: 8792 is the
stock run, 8790 and 8791 the Raven run. Open `/observer` and connect. The aggregator leg has its
own port because the SDK takes root pins only from an origin other than the Raven endpoint's;
`--aggregator-port` and `--stock-port` move the two aggregator entrances. Each session is written to
`observer-logs/`; the Replay tab plays a saved log, and Clear starts a new file rather than
emptying the old one.

Only commitments on the watch list can be found. `--commitments-file` takes a list or an earlier
session log; `--learn` also watches what the wallet names to the aggregator in the clear, and each
time the list grows every recorded request is searched again. The log is readable only from a
loopback page origin (or one given with `--allow-origin`).

`RAVEN_SDK_DIR=<sdk dir> pnpm observer:synthetic` regenerates the bundled sample session from the
real Raven SDK and the stock wallet transport against local mock servers.
