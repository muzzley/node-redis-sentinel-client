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
    async = require('async')


describe('sentinel failover', function(){
  
  it('redis servers are running as expected', function(done){
    
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
      if (error) return done(error)
      
      should.exist(pids.master.length)
      pids.master.length.should.equal(1)
      
      should.exist(pids.slave.length)
      pids.slave.length.should.equal(1)
      
      should.exist(pids.sentinel.length)
      pids.sentinel.length.should.equal(1)
      
      done()
    })
  })
  
  // it ('...')
  
  
})
