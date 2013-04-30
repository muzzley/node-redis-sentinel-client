/*
test a failover scenario
should lose no data (atomic set/get or pub/sub) during the failover.

to use this,
  - start a redis master on 5379
  - start a redis slave on 5380
  - start a redis sentinel on 8379, talking to the master
  - ./node_modules/.bin/mocha --ui tdd --reporter spec --bail test/test-failover
*/

var should = require('should'),
    RedisSentinel = require('../index'),
    redis = require('redis'),
    pidHelpers = require('./pid-helpers'),
    async = require('async'),
    events = require('events'),
    util = require('util'),
    child_process = require('child_process'),
    _suite


suite('sentinel failover', function(){
  
  // (want setup to run once, using BDD-style `before`)
  before( function(done){
    console.log('SETUP')

    _suite = this;

    this.events = new events.EventEmitter;

    this.hashKey = "test-sentinel-" + Math.round(Math.random() * 1000000);
    console.log("Using test hash", this.hashKey)

    this.errorLog = []
    this.ignoreErrors = false;

    this.emitError = function emitError(error){
      if (! _suite.ignoreErrors) {
        _suite.errorLog.push(error)
        _suite.events.emit('error', error);
      }
    }

    // crash whatever test is running.
    // (if it gets here, it wasn't deliberately ignored.)
    _suite.events.on('error', function(error){
      throw error;
    })

    this.sentinelClient = RedisSentinel.createClient(8379, '127.0.0.1');

    // catch & log events
    this.eventLog = [];

    ['error', 'reconnecting', 'end', 'drain', 'ready', 'connect',
     'down-start', 'failover-start', 'failover-end', 'reconnected'].forEach(function(eventName){
      try {
        _suite.sentinelClient.on(eventName, function() {
          _suite.eventLog.push(eventName);
          
          var msg = 'sentinel client ' +
            (_suite.sentinelClient.server_info ? _suite.sentinelClient.server_info.role : '[no role]') + ' ' +
            (_suite.sentinelClient.server_info ? _suite.sentinelClient.server_info.tcp_port : '[no port]') + ' ' +
            'got ' + eventName;
          
          console.log(msg, util.inspect(arguments,false,0))
        })
      } catch (e) {
        console.error("can't listen to " + eventName);
      }      
    });


    this.waitForEvent = function(eventName, callback){
      // already happened?
      if (_suite.eventLog.indexOf(eventName) > -1) {
        callback()
      }
      else {
        // wait
        _suite.sentinelClient.on(eventName, function(){
          callback()
        })
      }
    }


    this.doAtomicIO = function doAtomicIO(ioCount) {
      console.log("-- set", ioCount)
      
      var n = ioCount.toString(),
        client = _suite.sentinelClient
      
      client.hset(_suite.hashKey, n, n, function(error) {
        if (error) return _suite.emitError(error)
        
        client.hget(_suite.hashKey, n, function(error, val) {
          if (error) return _suite.emitError(error)

          console.log("---- get " + n, (val === n).toString());
          
          client.hgetall(_suite.hashKey, function(error, hash) {
            if (error) return _suite.emitError(error);

            if (typeof hash !== 'object')
              return _suite.emitError(new Error("Missing hash " + _suite.hashKey));

            var missing = _suite.checkIntegrity(hash, ioCount);

            if (missing.length) {
              _suite.emitError(new Error("Missing " + missing.join(',')))
            }
            else {
              console.log('---- get/set integrity confirmed', n)
              _suite.events.emit('success', ioCount)
            }
          })
        })
      })
    }

    this.checkIntegrity = function checkIntegrity(values, lastValue){
      var i, missing = [];
      for (i = 1; i <= lastValue; i++) {
        if (Array.isArray(values)){   // array by value
          if (values.indexOf( i.toString() ) === -1) missing.push(i)
        }
        else if (! values[ i.toString() ]) {   // hash by key
          missing.push(i)
        }
      }
      // console.log(missing.length + ' missing for ' + lastValue, [values, missing])
      return missing
    }


    this.receivedPubs = []
    this.pubChannel = "test-sentinel-channel-" + Math.round(Math.random() * 1000000)
    console.log("Test pub/sub channel", this.pubChannel)

    this.subscriberClient = RedisSentinel.createClient(8379, '127.0.0.1');

    this.subscriberClient.on('error', this.emitError);

    this.subscriberClient.once('ready', function(){
      _suite.subscriberClient.subscribe(_suite.pubChannel)
      _suite.subscriberClient.on('message', function(channel, message){
        if (channel === _suite.pubChannel) {
          _suite.receivedPubs.push(message)
          _suite.events.emit('message', message)
          console.log('---- received channel message', message)
        }
      })
    })

    this.doPub = function doPub(ioCount){
      console.log("-- pub", ioCount);
      var n = ioCount.toString();
      _suite.sentinelClient.publish(_suite.pubChannel, n, function(error, receivedBy){
        if (error) _suite.emitError(error)
      })
    }

    // wait for clients to be ready
    async.parallel([
      function(ready){
        if (_suite.sentinelClient.ready === true) ready()
        else _suite.sentinelClient.once('ready', ready)
      },
      function(ready){
        if (_suite.subscriberClient.ready === true) ready()
        else _suite.subscriberClient.once('ready', ready)
      }
    ], done)

  }); //setup


  test('redis servers are running as expected', function(done){
    // this assumes redis-server daemons are launched w/ these particular args!
    async.series({
      master: function(ok){
        pidHelpers.findPid(['redis-server', '--port 5379'], ok)
      },
      slave: function(ok){
        pidHelpers.findPid(['redis-server', '--port 5380', 'slaveof'], ok)
      },
      sentinel: function(ok){
        pidHelpers.findPid(['redis-server', '--sentinel'], ok)
      }
    }, function(error, pids){
      if (error) return _suite.emitError(error)

      should.exist(pids.master.length)
      pids.master.length.should.equal(1)
  
      should.exist(pids.slave.length)
      pids.slave.length.should.equal(1)

      should.exist(pids.sentinel.length)
      pids.sentinel.length.should.equal(1)

      // use later
      _suite.pids = pids;

      done()
    })
  })


  // sanity check
  suite('helpers', function(){
    test('checkIntegrity', function(){
      should.equal(_suite.checkIntegrity(['1','2','3'], 3).length, 0)
      should.equal(_suite.checkIntegrity({ '1': '1', '2': '2', '3': '3' }, 3).length, 0)
      should.equal(_suite.checkIntegrity({ '1': '1', '3': '3' }, 3).length, 1)
      should.equal(_suite.checkIntegrity(['1','3'], 3).length, 1)
    })
  })


  suite('failover', function(){

    before( function(){
      // repeatedly set & get some data
      _suite.ioCount = 0
      _suite.ioInterval = setInterval(function(){
        _suite.ioCount++
        _suite.doAtomicIO(_suite.ioCount)
        _suite.doPub(_suite.ioCount)
      }, 1000)
    })

    after(function(){
      if (_suite.ioInterval) clearInterval(_suite.ioInterval)
    })


    test('normal IO works', function(done){
      this.timeout(5000)

      // wait for a few good hits
      _suite.events.on('success', function(ioCount){
        if (ioCount === 3) return done()
      })
    })


    test('normal pub/sub works', function(done){
      this.timeout(5000)

      _suite.events.once('message', function(message){
        var missing = _suite.checkIntegrity( _suite.receivedPubs, _suite.ioCount );
        should.equal(missing.length, 0, "no pub/sub data missing")
        done()
      });
    })


    test('kill master', function(done){
      this.timeout(30000)

      this.ignoreErrors = true;

      if (!this.pids || !this.pids.master || isNaN(this.pids.master[0].pid)) {
        return done(new Error("Missing master PID from setup"))
      }

      console.warn("*** FAILOVER CAN TAKE A WHILE, DON'T QUIT TOO SOON ***");

      var masterPid = this.pids.master[0].pid
      console.log("Killing master pid", masterPid)

      async.series({
        killMaster: function(next){
          child_process.exec("kill " + masterPid, function(error, stdout, stderr) {
            if (error) return next(error)
            else if (stderr.trim() !== '') return next(new Error(stderr.trim()))
            else next()
          })
        },
        wait: function(next){
          // 1s buffer to make sure
          setTimeout(next, 1000)
        },
        confirm: function(next){
          pidHelpers.findPid(['redis-server', '--port 5379'], function(error, pids){
            if (error) return next(error)
            // console.log('new pids', pids)
            should.equal(pids.length, 0, 'master pid gone')

            console.log("... should failover now!")
            next()
          })
        }
      }, function(error){
        ///if(error){ console.log('--- got error', error) }
        done(error)
      })

    })

    test('should get \'down-start\'', function(done){
      this.timeout(5000)
      this.waitForEvent('down-start', done)
    })


    // NOTE, failover delay is based on 'down-after-milliseconds'
    // and other params (e.g.) in sentinel.conf
    // ... 45s is very long and should suffice in a reasonable setup.

    test('should get \'failover-start\'', function(done){
      this.timeout(45000)
      this.waitForEvent('failover-start', done)
    })

    test('should get \'failover-end\'', function(done){
      this.timeout(45000)
      this.waitForEvent('failover-end', done)
    })

    test('should get \'reconnected\'', function(done){
      this.timeout(10000)
      this.waitForEvent('reconnected', done)
    })

    test('no errors or data loss', function(){
      // shouldn't be any more errors
      this.ignoreErrors = false;

      console.log('--- should be empty', this.errorLog);

      should.equal(this.errorLog.length, 0)
    })

    test('slave is now master', function(done){
      this.timeout(5000)

      var directClient = redis.createClient(5380)
      if (!directClient) return done(new Error("Failed to create client"))

      directClient.on('error', function(error){
        console.error("Error with direct slave client")
        done(error)
      })

      directClient.once('ready', function(){
        should.equal(directClient.server_info.role, 'master')
        done()
      })
    })

    test('continous atomic I/O lost no data', function(done){
      this.timeout(2000)
      var _done = false;    // only once
      this.events.on('success', function(ioCount){
        if (ioCount >= _suite.ioCount && !_done) {
          _done = true
          done()
        }
      })
    })

    test('continous pub/sub lost no data', function(done){
      this.timeout(2000)
      var _done = false;    // only once
      this.events.on('message', function(message){
        // wait for last,
        // make sure none earlier missing
        if (+message >= _suite.ioCount && !_done) {          
          should.equal( _suite.checkIntegrity( _suite.receivedPubs, _suite.ioCount ).length, 0, "no pub/sub data missing")          
          _done = true
          done()
        }
      })
    })
  })

});
