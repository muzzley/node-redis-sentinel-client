/*
test standard redis i/o with a RedisSentinelClient
*/

// note, there's no standard port defined in docs, this is arbitrary.
var HOST = '127.0.0.1';
var PORT = 8379;

var should = require('should');
var RedisSentinel = require('../index');

// test helpers shared with node_redis tests
var testUtils = require('redis/test/utils.js'),
    require_string = testUtils.require_string,
    require_error = testUtils.require_error,
    require_number = testUtils.require_number;

var MockLogger = testUtils.MockLogger;


suite('RedisSentinelClient', function(){

  suite('client', function(){
    test('is exported', function(){
      should(typeof RedisSentinel.RedisSentinelClient === 'function');
    });

    var logger = new MockLogger();
    // logger.toConsole = true;

    var client = RedisSentinel.createClient(PORT, HOST, {
      logger: logger,
      debug: true
    });

    var errors = [];

    client.on('error', function(error){
      errors.push(error);
    });

    test('is a sentinel client', function(){
      should(client instanceof RedisSentinel.RedisSentinelClient);
    });

    test('is ready', function(done){
      var timeout = setTimeout(function(){
        should.fail("Ready timed out");
        done();
      }, 2000);

      client.on('reconnected', function(){
        clearTimeout(timeout);
        done();
      });
    });

    test('should handle external logger', function(){
      client.debug('test debug');
      client.log('info', 'test info');
      should.deepEqual(logger.msgs.pop(), [ 'info', 'test info' ]);
      should.deepEqual(logger.msgs.pop(), [ 'debug', 'test debug' ]);
    });

    test('is an event emitter', function(done){
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

    test('exposes its master client', function(){
      should.strictEqual(client.activeMasterClient, client.getMaster());
    });

    test('passes through static properties', function(){
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

    test('should have no errors', function(){
      errors.forEach(should.ifError);
    });
  });


  suite('createClient', function(){
    test('should handle 3 parameters', function(done){
      var client = RedisSentinel.createClient(PORT, HOST, {
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

    test('should handle 1 parameter', function(done){
      var client = RedisSentinel.createClient(PORT, HOST, {
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
  });



  // commands should pass thru to master client
  suite('commands', function(){
    var client = RedisSentinel.createClient(PORT, HOST, {
      logger: new MockLogger(),
      debug: false
    });

    var errors = [];

    client.on('error', function(error){
      errors.push(error);
    });


    // (nesting suites for easier-to-read results,
    //  and for flow control)
    suite('single', function(){
      var key = 'test_single'
          num = "9007199254740992";

      test('should set', function(done){
        client.set(key, num, function(error, result){
          should.ifError(error);
          should.strictEqual(result.toString(), "OK");
          done();
        });
      });

      test('should get', function(done){
        client.get(key, function(error, result){
          should.ifError(error);
          should.strictEqual(num, result.toString());
          done();
        });
      });

      test('should incr', function(done){
        client.incr(key, function(error, result){
          should.ifError(error);
          should.strictEqual((num*1)+1, result.toString()*1);
          done();
        });
      });
    });


    suite('hmget', function(){
      // copied from index.js' tests.HMGET
      var key1 = "test hash 1",
          key2 = "test hash 2",
          name = "HMGET";

      test('should hmset key1 with splat', function(done){
        // redis-like hmset syntax
        client.HMSET(key1,
          // key,val,key,val
          "0123456789", "abcdefghij", "some manner of key", "a type of value",
          require_string("OK", name, done));
      });

      test('should hmset key2 with array', function(done){
        // (try lower- and upper-case methods)
        // fancy hmset syntax
        client.hmset(key2, {
          "0123456789": "abcdefghij",
          "some manner of key": "a type of value"
        }, require_string('OK', name, done));
      });

      test('should hmget key1 with splat', function(done){
        client.HMGET(key1, "0123456789", "some manner of key", function (error, reply) {
          should.strictEqual("abcdefghij", reply[0].toString());
          should.strictEqual("a type of value", reply[1].toString());
          done();
        });
      });

      test('should hmget key2 with splat', function(done){
        client.hmget(key2, "0123456789", "some manner of key", function (error, reply) {
          should.ifError(error);
          should.strictEqual("abcdefghij", reply[0].toString(), 'reply[0]');
          should.strictEqual("a type of value", reply[1].toString(), 'reply[1]');
          done();
        });
      });

      test('should hmget key1 with array(1)', function(done){
        client.HMGET(key1, ["0123456789"], function (error, reply) {
          should.strictEqual("abcdefghij", reply[0]);
          done();
        });
      });

      test('should hmget key1 with array(2)', function(done){
        client.hmget(key1, ["0123456789", "some manner of key"], function (error, reply) {
          should.strictEqual("abcdefghij", reply[0]);
          should.strictEqual("a type of value", reply[1]);
          done();
        });
      });

      test('should hmget key1 with missing keys', function(done){
        client.HMGET(key1, "missing thing", "another missing thing", function (error, reply) {
          should.strictEqual(null, reply[0]);
          should.strictEqual(null, reply[1]);
          done();
        });
      });

    });


    // @todo more commands...

  }); // commands

});

