// start MongoDB with Mongoose
const mongoose = require('mongoose');
mongoose.Promise = require('bluebird'); // Use bluebird promises

const crawlerModel = require('../models/crawlerModel');

const _ = require('lodash');
const topology = require("./topology.js");
// insert configuration file
const config = require('../../configuration.js')(process.env.NODE_ENV);

mongoose.connect(config.mongodb.uri, config.mongodb.options);

const levelup = require('level');
var LvlDB = levelup(config.levelup.location, config.levelup.options, function (err, db) {
  if (err) throw err
  console.log(db.db.getProperty('leveldb.num-files-at-level0'));
  console.log(db.db.getProperty('leveldb.stats'));
  console.log(db.db.getProperty('leveldb.sstables'));
});

const Promise = require('bluebird');
const URL = require('url');
const dns = require('dns');
const dnscache = require('dnscache')({
  "enable": true,
  "ttl": 300,
  "cachesize": 1000
});

// Rabbot is a module to simplify RabbitMQ control
const rabbit = require('rabbot');

rabbit.on("connected", function (connection) {
  console.log(`RabbitMQ connected!! Event trigger for ${connection.name}`);
  // rabbit.retry(); // retry to connect
});
rabbit.on("unreachable", function (connection) {
  console.log(`RabbitMQ connection is unreachable Event trigger for ${connection.name}`);
  rabbit.retry(); // retry to connect
});
rabbit.on("failed", function (connection) {
  console.log(`RabbitMQ connection failed Event trigger for ${connection.name}`);
  rabbit.retry(); // retry to connect
});
rabbit.on("closed", function (connection) {
  console.log(`RabbitMQ connection closed (intentional) Event trigger for ${connection.name}`);
  // rabbit.retry(); // retry to connect
});

const initTopology = function () {
  return crawlerModel.find().then(function (docs) {

    return topology(rabbit, docs)
      .then(function () {
        console.info('RabbitMQ connection started');
      }).catch(function (err) {
        console.error('RabbitMQ configuration failed', err);
      });
  }).catch(function (err) {
    console.error('MongoDB crawlerModel search failed', err);
  });
}

const publishCrawlerRequest = function (url, uniqueUrl, executionDoc) {
  return rabbit.publish("trackinops.crawler-request-router", {
    routingKey: 'crawler.' + executionDoc.crawlerCustomId + '.execution.' + executionDoc._id,
    type: 'crawler.' + executionDoc.crawlerCustomId + '.execution.' + executionDoc._id,
    messageId: uniqueUrl,
    body: {
      url: url,
      uniqueUrl: uniqueUrl,
      executionDoc: executionDoc,
      timestamp: Date.now()
    },
    timestamp: Date.now(),
    expiresAfter: 1000 * 60 * 60 * 24 * 7 // 7 days
  }, config.rabbit.connection.name)
    .then(function () {
      console.info('Published to RabbitMQ, execution._id =', executionDoc._id);
    });
}

const publishParserRequest = function (url, uniqueUrl, executionDoc) {
  return rabbit.publish("trackinops.crawler-parser-router", {
    routingKey: 'parser.' + executionDoc.crawlerCustomId + '.execution.' + executionDoc._id,
    type: 'parser.' + executionDoc.crawlerCustomId + '.execution.' + executionDoc._id,
    messageId: uniqueUrl,
    body: {
      url: url,
      uniqueUrl: uniqueUrl,
      executionDoc: executionDoc,
      timestamp: Date.now()
    },
    timestamp: Date.now(),
    expiresAfter: 1000 * 60 * 60 * 24 * 7 // 7 days
  }, config.rabbit.connection.name)
    .then(function () {
      console.info('Published to RabbitMQ, execution._id =', executionDoc._id);
    });
}
/**
* @public
*  // @paramm {String} routingKey - where to requeue
*  // @paramm {String} type = routingKey - by default for crawler requests bindings
* @param {MongoId} requestsId
* @param {*} bodyData - data to include in a message
* @returns {Promise}
*
*/



const startRequeueSubscription = function () {
  rabbit.handle({
    queue: 'Requeue.crawler_queUrlList_requeue',
    type: 'Requeue.crawler_requeue'
  }, function (msg) {
    console.info("Received:", msg.properties.messageId, "routingKey:", msg.fields.routingKey);

    return queUrlList(msg.body.urlList, msg.body.executionDoc)
      .then(function (queuedUrlList) {
        // console.info(queuedUrlList);
        msg.ack();
      }).catch(function (err) {
        console.error(err);
        msg.nack();
      });
  });

}

function matchesRegex(string, regex) {
  return (new RegExp(regex, 'i')).test(string);
}

function levelDBisOpen() {

}

function levelDBput(key, value) {
  return new Promise(function (resolve, reject) {
    LvlDB.put(key, value, function (err) {
      if (err) reject(new Error(`LevelDB key ${key} put error: ${err}`));
      resolve();
    })
  })
}

function levelDBkeyNotFound(key) {
  return new Promise(function (resolve, reject) {
    LvlDB.get(key, { fillCache: true, asBuffer: true }, function (err, value) {
      if (err) {
        if (err.notFound) {
          // handle a 'NotFoundError' here
          return resolve();
        }
        // I/O or other error, pass it up the callback chain
        // return callback(err)
        reject(new Error(`LevelDB key: ${key}, keyNotFound error: ${err}`));
      }
      // .. handle `value` here
      reject(new Error(`LevelDB key already found: ${key}`));
    })
  })
}

function levelDBdel() {

}

function queUrlList(urlList, executionDoc) {
  // TODO: pre-check links if they are loadable (correct url; not 301; etc.), CACELED: saving links on error, so checking works on the processor itself

  // return requestModel.reachedMaxCrawledPagesLimit(executionDoc._id, executionDoc.maxCrawledPages)
  //   .then(function (alreadyQueuedCount) {
  //     console.info(executionDoc._id + ' already queued ' + alreadyQueuedCount);

  const queued = [];
  const parallel = 5;
  return Promise.all(urlList.map(function (url) {
    // return isValidUrlByDNSHost(url)
    //   .then(function (url) {
    return constructUniqueUrl(url, executionDoc.urlConstructor.urlIncludeFragment, executionDoc.urlConstructor.remove)
      .then(function (uniqueUrl) {
        // How many links must download before fetching the next?
        // The queued, minus those running in parallel, plus one of 
        // the parallel slots.
        let mustComplete = Math.max(0, queued.length - parallel + 1);
        // when enough links are complete, queue another request for an item    
        let download = Promise.some(queued, mustComplete)
          .then(function () {
            // checking if the uniqueUrl haven't been already queued
            return levelDBkeyNotFound(uniqueUrl)
              .then(() => levelDBput(uniqueUrl, { executionId: executionDoc._id, timestamp: Date.now() }))
              .then(() => {
                if (matchesRegex(url, executionDoc.followLinks.parserUrlRegex)) {
                  return Queue.publishParserRequest(url, uniqueUrl, executionDoc);
                } else {
                  return Promise.resolve();
                }
              })
              .then(() => Queue.publishCrawlerRequest(url, uniqueUrl, executionDoc))
              .then(() => {
                console.info({
                  'status': 'resolved',
                  'execution': executionDoc._id,
                  'uniqueUrl': uniqueUrl
                });
                return {
                  'status': 'resolved',
                  'execution': executionDoc._id,
                  'uniqueUrl': uniqueUrl
                };
              })
              .catch(function (err) {
                console.info({
                  'status': 'rejected',
                  'execution': executionDoc._id,
                  'uniqueUrl': uniqueUrl,
                  'reason': err.message // when logging to file, include full err
                });
                return {
                  'status': 'rejected',
                  'execution': executionDoc._id,
                  'uniqueUrl': uniqueUrl,
                  'reason': err.message // when logging to file, include full err
                };
              });
          })
          .catch(Promise.AggregateError, function (err) {
            err.forEach(function (e) {
              console.error(e.stack);
            });
            throw err;
          });

        queued.push(download);
        return download.then(function (result) {
          // after that new url is created    
          return result;
        });
      }).catch(function (err) {
        // constructUniqueUrl failed 
        // save failed erro information somewhere 
        console.error(new Error('constructUniqueUrl ' + err));
        throw new Error('constructUniqueUrl ' + err);
      });
    // }).catch(function (err) {
    //   // isValidUrlByDNSHost failed
    //   // save failed erro information somewhere 
    //   console.error(err);
    // });
  }));
  // })
}
function isValidUrlByDNSHost(url) {
  return new Promise(function (resolve, reject) {
    host = URL.parse(url, true).host; // https://nodejs.org/api/url.html#url_url_parse_urlstring_parsequerystring_slashesdenotehost
    return dnscache.lookup(host, { family: 4 }, // https://nodejs.org/api/dns.html#dns_dns_lookup_hostname_options_callback
      function (err, address, family) {
        if (err) reject(new Error(url + ' is not valid URL'));
        console.info('isValidUrlByDNSHost; url: %j address: %j family: IPv%s', url, address, family);
        return resolve(url);
      })
  });
}

// not used any more, changed to isValidUrlByDNSHost
// function isValidUrlByRegex(url) {
//   // TODO: sometimes url can be encoded like http%3A//domain.com, regex should deal with it
//   let pattern = new RegExp('^(https?:\\/\\/)+' + // protocol
//     '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
//     '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
//     '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
//     '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
//     '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
//   return new Promise(function (resolve, reject) {
//     if (!pattern.test(url)) {
//       // not valid url is rejected
//       return reject(new Error(url + ' is not valid URL'));
//     } else {
//       return resolve(url);
//     }
//   });
// }

// sorting collection by it's keys
const sortByKeys = object => {
  const keys = Object.keys(object)
  const sortedKeys = _.sortBy(keys)

  return _.fromPairs(
    _.map(sortedKeys, key => [key, object[key]])
  )
}

function constructUniqueUrl(url, fragmentEnabled = false, constructorRemove) {
  return new Promise(function (resolve, reject) {
    url = url.toLowerCase(); // whole url are converted to lower case
    url = URL.parse(url, true); // 'true' - query will be object
    if (url.host) {
      // remove not wanted regex from pathname
      if (!_.isEmpty(constructorRemove.pathname)) {
        _.forEach(constructorRemove.pathname, function (pathnameRemoveRegex) {
          return url.pathname = _.replace(url.pathname, new RegExp(pathnameRemoveRegex, 'i'), '')
        })
      }

      // removes trailing slash from pathname
      if (_.endsWith(url.pathname, '/')) {
        url.pathname = url.pathname.substring(0, url.pathname.length - 1);
      }
      // pathname value is trimmed of whitespaces
      // url.pathname = _.trim(url.pathname, '%20'); // commented because trims all %,2,0 chars
      url.pathname = _.trim(url.pathname, '+');
      url.pathname = _.trim(url.pathname, ' ');

      if (url.search) { // formatting url querystring
        let newQuery = url.query;
        _.each(_.keys(newQuery), function (key) {
          // query string values trimmed of whitespaces
          // newQuery[key] = _.trim(newQuery[key], '%20'); // commented because trims all %,2,0 chars
          newQuery[key] = _.trim(newQuery[key], '+');
          newQuery[key] = _.trim(newQuery[key], ' ');

          // query parameter is removed if it's pair name matches regex on constructorRemove.query
          if (!_.isEmpty(constructorRemove.query)) {
            _.forEach(constructorRemove.query, function (queryRemoveRegex) {
              if ((new RegExp(queryRemoveRegex, 'i')).test(key)) {
                return delete newQuery[key];
              }
            })
          }
        });
        url.query = newQuery;
        // deleting search parameter to include query into URL.format()
        delete url.search;

        // query parameters are sorted alphabetically
        url.query = sortByKeys(url.query);
      }

      // delete disabled url fragment
      if (!fragmentEnabled) {
        delete url.hash;
      } else {
        // fragment or hash can also have strings that should be removed
        if (url.hash && !_.isEmpty(constructorRemove.fragment)) {
          _.forEach(constructorRemove.fragment, function (fragmentRemoveRegex) {
            return url.hash = _.replace(url.hash, new RegExp(fragmentRemoveRegex, 'i'), '')
          })
        }
      }

      console.info('constructUniqueUrl ' + URL.format(url));
      return resolve(URL.format(url));
    } else {
      console.error(new Error(url.href + ' can not convert to uniqueUrl'));
      return reject(new Error(url.href + ' can not convert to uniqueUrl'));
    }
  });
}

exports = module.exports = Queue = {
  initTopology: initTopology,
  publishCrawlerRequest: publishCrawlerRequest,
  publishParserRequest: publishParserRequest,
  startRequeueSubscription: startRequeueSubscription
};
