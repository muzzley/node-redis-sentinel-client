/*
test a failover scenario
should lose no data during the failover.

to use this,
  - start a redis master on 5379
  - start a redis slave on 5380
  - start a redis sentinel on 8379, talking to the master
  - npm test
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
  
  before( function(){
    _suite = this;
    
    this.events = new events.EventEmitter
    
    this.hashKey = "test-sentinel-" + Math.round(Math.random() * 1000000)
    console.log("Using test hash", this.hashKey)
    
    this.errorLog = []
    this.emitError = function emitError(error){
      this.errorLog.push(error)
      _suite.events.emit('error', error);
    }
    
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

    
    this.doIO = function doIO(ioCount) {
      console.log("---- set " + ioCount + " ----");
      
      var n = ioCount.toString(),
        client = _suite.sentinelClient
      
      client.hset(_suite.hashKey, n, n, function(error) {
        if (error) return _suite.emitError(error)
        
        client.hget(_suite.hashKey, n, function(error, val) {
          if (error) return _suite.emitError(error)

          console.log(n + " Set?", (val === n).toString());
          
          client.hgetall(_suite.hashKey, function(error, hash) {
            if (error) return _suite.emitError(error);

            var i,
              missing = [];
            
            if (typeof hash !== 'object')
              return _suite.emitError(new Error("Missing hash " + _suite.hashKey));
            
            for (i = 1; i <= ioCount; i++) {
              if (! hash[ i.toString() ]) missing.push(i)
            }

            if (missing.length) {
              _suite.emitError(new Error("Missing " + missing.join(',')))
            }
            else {
              console.log('All data found', n)
              _suite.events.emit('success', ioCount)
            }
          })
        })
      })
    }
    
    
    _suite.events.on('error', function(error){
      console.warn("THROWING AN ERROR INTO THE ABYSS...")
      throw error;  // ???
    })

  });
  
  
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
  
  
  suite('failover', function(){
    before( function(){
      // repeatedly set & get some data
      _suite.ioCount = 0
      _suite.ioInterval = setInterval(function(){
        _suite.ioCount++
        _suite.doIO(_suite.ioCount)
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
      
      _suite.events.on('error', done)
    })
    
    
    test('kill master', function(done){
      this.timeout(30000)
      
      this.events.on('error', done)

      if (!this.pids || !this.pids.master || isNaN(this.pids.master[0].pid)) {
        return done(new Error("Missing master PID from setup"))
      }
      
      // console.log('all pids', this.pids)
      
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
      }, done)
    
    })

    test('should get \'down-start\'', function(done){
      this.timeout(5000)
      this.waitForEvent('down-start', done)
    })
  
    test('should get \'failover-start\'', function(done){
      this.timeout(30000)
      this.waitForEvent('failover-start', done)
    })
    
    test('should get \'failover-end\'', function(done){
      this.timeout(30000)
      this.waitForEvent('failover-end', done)
    })

    test('should get \'reconnected\'', function(done){
      this.timeout(30000)
      this.waitForEvent('reconnected', done)
    })
    
    test('no errors or data loss', function(){
      should.equal(this.errorLog, 0)
    })
    
    test('slave is now master', function(done){
      this.timeout(5000)
      var directClient = redis.createClient(5380)
      if (!directClient) return done(new Error("Failed to create client"))

      directClient.on('error', done)
    
      directClient.on('ready', function(){
        should.equal(directClient.server_info.role, 'master')
        done()
      })
    })

    test('continous still successful', function(done){
      this.timeout(2000)
      
      this.events.once('error', done)
      this.events.on('success', function(ioCount){
        if (ioCount === _suite.ioCount) done()
      })
    })
  })

})
