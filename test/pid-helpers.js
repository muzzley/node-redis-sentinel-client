/*
helpers for handling redis-server processes.
going semi-colon free.
*/

var child_process = require('child_process')


/*
@param patterns: array of, or single, regex pattern(s) or string(s). (has to match all)
*/
module.exports.findPid = function findPid(patterns, callback){

  child_process.exec('ps -e -o pid,command', function(error, stdout, stderr){
    if (error) return callback(error)
    else if (stderr.trim() !== '') return callback(new Error(stderr.trim()))
    
    var procList = stdout.split("\n"),
        l, procLine, proc, pattern,
        procs = [],
        matches = false
    
    // first line is headers
    procList.shift()
    
    for (l in procList) {
      procLine = procList[l],
      procParts = procLine.match(/^([0-9]*)\s(.*)$/) || []
      
      proc = {
        pid: procParts[1] || null,
        cmd: procParts[2] || null
      }
      
      if (proc.pid && proc.pid.trim() !== '' && proc.cmd && proc.cmd.trim() !== '') {
        // allow for no pattern, then returns all.
        // presume match unless it fails a pattern.
        matches = true
        
        if (! Array.isArray(patterns)) patterns = [ patterns ]
          
        for (l in patterns) {
          pattern = patterns[l]

          // - as a string
          if (typeof pattern === 'string') {
            if (proc.cmd.indexOf(pattern) < 0) {
              matches = false
            }
          }

          // - as a regex pattern
          else if (pattern != null && !proc.cmd.match(pattern)) {
            matches = false
          }
        }
        
        if (matches) procs.push(proc)
      }
    }
    
    callback(null, procs)
  })
}

