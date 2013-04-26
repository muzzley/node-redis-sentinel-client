// tests for RedisSentinelClient.
// separating from test.js b/c can't assume a sentinel is running in most environments.
//
// run me w/ _mocha_ rather than custom runner in test.js
//
// `./node_modules/mocha/bin/mocha --ui bdd --reporter spec ./test/test_sentinel.js`
//

// note, there's no standard port defined in docs, this is arbitrary.
var HOST = '127.0.0.1';
var PORT = 8379;

var should = require('should');

var sentinel = require('../index');

// don't want directly, exported via index
// var Sentinel = require('../lib/sentinel');

// test helpers exported from test.js
var testUtils = require('./utils'),
    require_string = testUtils.require_string,
    require_error = testUtils.require_error,
    require_number = testUtils.require_number;

var MockLogger = testUtils.MockLogger;


describe('RedisSentinelClient', function(){

  describe('client', function(){
    it('is exported', function(){
      should(typeof sentinel.RedisSentinelClient === 'function');
    });

    var logger = new MockLogger();
    // logger.toConsole = true;

    var client = sentinel.createClient(PORT, HOST, {
      logger: logger,
      debug: true
    });

    var errors = [];

    client.on('error', function(error){
      errors.push(error);
    });

    it('is a sentinel client', function(){
      should(client instanceof sentinel.RedisSentinelClient);
    });

    it('is ready', function(done){
      var timeout = setTimeout(function(){
        should.fail("Ready timed out");
        done();
      }, 2000);

      client.on('reconnected', function(){
        clearTimeout(timeout);
        done();
      });
    });

    it('should handle external logger', function(){
      client.debug('test debug');
      client.log('info', 'test info');
      should.deepEqual(logger.msgs.pop(), [ 'info', 'test info' ]);
      should.deepEqual(logger.msgs.pop(), [ 'debug', 'test debug' ]);
    });

    it('is an event emitter', function(done){
      var timeout = setTimeout(function(){
        should.fail("EventEmitter timed out");
        done();
      }, 1000);
      client.on('test msg', function(){
        clearTimeout(timeout);
        done();
      });
      client.emit('test msg');
    });

    it('exposes its master client', function(){
      should.strictEqual(client.activeMasterClient, client.getMaster());
    });

    it('passes through static properties', function(){
      // piggyback on an existing property,
      // should be accessible via getter & setter
      var prop = 'server_info',
        initialVal = client.activeMasterClient[prop];

      should.deepEqual(client[prop], initialVal);

      client.activeMasterClient[prop] = { newStatus: 'Changed on master' };
      should.deepEqual(client[prop], { newStatus: 'Changed on master' });

      client.activeMasterClient[prop] = { newStatus: 'Changed again on master' };
      should.deepEqual(client[prop], { newStatus: 'Changed again on master' });

      // put back just in case it matters,
      // and tests setter
      client[prop] = initialVal;
      should.deepEqual(client.activeMasterClient[prop], initialVal);
    });

    it('should have no errors', function(){
      errors.forEach(should.ifError);
    });


    /*
    // this fails. refs need to be totally atomic.
    it('should hold client reference', function(){
      // simulate a new connection
      client.__proto__.simulateReconnect = function(){
        this.activeMasterClient = {
          testX: 200,
          testY: 300
        };
      };

      var clientRef = client.activeMasterClient;

      console.log('orig client.activeMasterClient', client.activeMasterClient);
      console.log('orig clientRef', clientRef);

      client.activeMasterClient.testX = 100;
      should.equal(clientRef.testX, 100);

      client.simulateReconnect();
      console.log('new client.activeMasterClient', client.activeMasterClient);
      console.log('new clientRef', clientRef);

      should.equal(clientRef.testX, 200);
      should.equal(clientRef.testY, 300);

      // back to real connection
      client.activeMasterClient = null;
      client.reconnect();
    });
    */
  });


  describe('createClient', function(){
    it('should handle 3 parameters', function(done){
      var client = sentinel.createClient(PORT, HOST, {
        logger: new MockLogger(),
        fakeOption: 'Z'
      });

      var timeout = setTimeout(function(){
        should.fail("Timed out");
        done();
      }, 2000);

      client.on('reconnected', function(){
        clearTimeout(timeout);
        should.equal(this.options.host, HOST);
        should.equal(this.options.port, PORT);
        should.equal(this.options.fakeOption, 'Z');
        done();
      });
    });

    it('should handle 1 parameter', function(done){
      var client = sentinel.createClient(PORT, HOST, {
        logger: new MockLogger(),
        fakeOption: 'Z'
      });

      var timeout = setTimeout(function(){
        should.fail("Timed out");
        done();
      }, 2000);

      client.on('reconnected', function(){
        clearTimeout(timeout);
        should.equal(this.options.host, HOST);
        should.equal(this.options.port, PORT);
        should.equal(this.options.fakeOption, 'Z');
        done();
      });
    });

  //   it('should throw error when missing host or port', function(){
  //     try {
  //       // this is kind of moot now, b/c it's delegated to sentinel.createClient,
  //       // but try it directly anyway
  //       var client = redis.RedisSentinelClient.createClient({
  //         logger: new MockLogger()
  //       });
  //       should.fail("No error was thrown");
  //     }
  //     catch(error) {
  //       should(error instanceof Error);
  //       should(error.message.match(/host/));
  //     }
  //   });
  // });


  // commands should pass thru to master client
  describe('commands', function(){
    var client = sentinel.createClient(PORT, HOST, {
      logger: new MockLogger(),
      debug: false
    });

    var errors = [];

    client.on('error', function(error){
      errors.push(error);
    });


    // (nesting suites for easier-to-read results,
    //  and for flow control)
    describe('single', function(){
      var key = 'test_single'
          num = "9007199254740992";

      it('should set', function(done){
        client.set(key, num, function(error, result){
          should.ifError(error);
          should.strictEqual(result.toString(), "OK");
          done();
        });
      });

      it('should get', function(done){
        client.get(key, function(error, result){
          should.ifError(error);
          should.strictEqual(num, result.toString());
          done();
        });
      });

      it('should incr', function(done){
        client.incr(key, function(error, result){
          should.ifError(error);
          should.strictEqual((num*1)+1, result.toString()*1);
          done();
        });
      });
    });


    describe('multi', function(){
      var name = "MULTI_1", multi1, multi2;

      // copied from index.js' tests.MULTI_1
      it('should mset 1st group', function(done){
        // Provoke an error at queue time
        multi1 = client.multi();

        // multi goes direct to the master client (for now)
        // (can try to make it queue in the sentinel client later)
        should.strictEqual(multi1.client.port, client.activeMasterClient.port);
        should.strictEqual(multi1.client.host, client.activeMasterClient.host);

        multi1.mset("multifoo", "10", "multibar", "20", require_string("OK", name));
        multi1.set("foo2", require_error(name));
        multi1.incr("multifoo", require_number(11, name));
        multi1.incr("multibar", require_number(21, name));
        multi1.exec(function(error, results){
          should.ifError(error);
          done();
        });
      });

      it('should mset 2nd group', function(done){
        // Confirm that the previous command, while containing an error, still worked.
        multi2 = client.multi();
        multi2.incr("multibar", require_number(22, name));
        multi2.incr("multifoo", require_number(12, name));
        multi2.exec(function (error, replies) {
          should.ifError(error);
          should.strictEqual(22, replies[0]);
          should.strictEqual(12, replies[1]);
          done();
        });
      });
    });


    describe('hmget', function(){
      // copied from index.js' tests.HMGET
      var key1 = "test hash 1",
          key2 = "test hash 2",
          name = "HMGET";

      it('should hmset key1 with splat', function(done){
        // redis-like hmset syntax
        client.HMSET(key1,
          // key,val,key,val
          "0123456789", "abcdefghij", "some manner of key", "a type of value",
          require_string("OK", name, done));
      });

      it('should hmset key2 with array', function(done){
        // (try lower- and upper-case methods)
        // fancy hmset syntax
        client.hmset(key2, {
          "0123456789": "abcdefghij",
          "some manner of key": "a type of value"
        }, require_string('OK', name, done));
      });

      it('should hmget key1 with splat', function(done){
        client.HMGET(key1, "0123456789", "some manner of key", function (error, reply) {
          should.strictEqual("abcdefghij", reply[0].toString());
          should.strictEqual("a type of value", reply[1].toString());
          done();
        });
      });

      it('should hmget key2 with splat', function(done){
        client.hmget(key2, "0123456789", "some manner of key", function (error, reply) {
          should.ifError(error);
          should.strictEqual("abcdefghij", reply[0].toString(), 'reply[0]');
          should.strictEqual("a type of value", reply[1].toString(), 'reply[1]');
          done();
        });
      });

      it('should hmget key1 with array(1)', function(done){
        client.HMGET(key1, ["0123456789"], function (error, reply) {
          should.strictEqual("abcdefghij", reply[0]);
          done();
        });
      });

      it('should hmget key1 with array(2)', function(done){
        client.hmget(key1, ["0123456789", "some manner of key"], function (error, reply) {
          should.strictEqual("abcdefghij", reply[0]);
          should.strictEqual("a type of value", reply[1]);
          done();
        });
      });

      it('should hmget key1 with missing keys', function(done){
        client.HMGET(key1, "missing thing", "another missing thing", function (error, reply) {
          should.strictEqual(null, reply[0]);
          should.strictEqual(null, reply[1]);
          done();
        });
      });

    });


    // @todo test these pass-thru commands when the master changes!

    // @todo need to make sure sentinels don't conflict w/each other!
    // how...? does RedisClient count its commands?

    // @todo need to clean up all these test keys?

  }); // commands

});

