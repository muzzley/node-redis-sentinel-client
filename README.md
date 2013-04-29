Redis Sentinel Client
===========================

Supplements [node_redis](https://github.com/mranney/node_redis) with [Redis Sentinel](http://redis.io/topics/sentinel) support.

## Goals:

1. Transparent, drop-in replacement for RedisClient, handling connections to master, slave(s), and sentinel in the background.
2. Handles all RedisClient operations (including pub/sub).
3. No loss of data during failover.

This was originally part of a [fork of node_redis](https://github.com/DocuSignDev/node_redis),
and has been subsequently split to its own module.
(However, it still currently requires changes to node_redis to work, so it still depends on the fork.)

See related thread about different approaches to Sentinel support: https://github.com/mranney/node_redis/issues/302


## `SentinelClient`

### Concepts

- connects to a single sentinel, which is watching a single master/slave(s) cluster
- maintains an activeMasterClient in the background, automatically updates on failover (using psub)
- behaves exactly like a single RedisClient
- passes thru all client commands, behaves transparently like a `RedisClient`

### Usage

```
var RedisSentinel = require('redis-sentinel-client');
var sentinelClient = RedisSentinel.createClient(PORT, HOST);
```

Now use `sentinelClient` as a regular client: `set`, `get`, `hmset`, etc.

### Instantiation options

- `masterName`: Which master the sentinel is listening to. Defaults to 'mymaster'. (If a sentinel is listening to multiple masters, create multiple `SentinelClients`.)
- `logger`: pass in [winston](https://github.com/flatiron/winston) or another custom logger, otherwises uses console. (Expects a `log` method.)
- `debug`: verbose output (to `logger` about internal ops)


### Methods

- `getMaster()`: returns a reference to the sentinel client's `activeMasterClient` (also available directly)
- `reconnect()`: used on instantiation and on psub events, this checks if the master has changed and connects to the new master.
- `send_command()` (and any other `RedisClient` command): command is passed to the master client.


### Events

- `sentinel message` (`msg`): passed up from the sentinel's channel listener. Note, messages can be about other masters, does not differentiate.
- `failover-start`: corresponds to sentinel's `+failover-triggered` message.
- `failover-end`: corresponds to sentinel's `+failover-end` message.
- `disconnected`: old master disconnected.
- `reconnected` (`newMasterClient`): new master reconnected. (In theory should be instant swapover, so no lag.) Passes new client ref for convenience.
    - (Use new ref for pub/sub and other long-running operations, otherwise let client pass through commands.)
- `error` (`error`): An error occured. (Currently does not differentiate errors in different components.) Will fire errors during a failover, before new master is connected.


### Limitations

- Unlike `RedisClient`, `SentinelClient` is not / does not need to be a stream
- Sentinel docs don't specify a default host+port, so option-less implementations of `createClient()` won't be compatible.
- Have not put any time into `multi` support, unknown status.


### Possible roadmap

- Multiple master/slave(s) clusters per sentinel
  - But thinking not: Just create multiple sentinel clients, one per cluster.


