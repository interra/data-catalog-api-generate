const fs = require('fs-extra');
const elasticlunr = require('elasticlunr');
const Schema = require('./schema');
const path = require('path');
const apiSubDir = 'api/v1';
const AWS = require('aws-sdk');

class Search {

  constructor(config) {
    this.schemasDir = config.get('schemasDir');
    this.schemaName = 'pod-light';
    this.schema = new Schema(this.schemaName, config);
    this.searchConfig = config.get('search');
    this.apiDir = 'build';
  }

  init(callback) {
    callback();
  }

  prepareSearchFields(doc, toString) {
    const prepped = {};
    this.searchConfig.fields.forEach((field) => {
      if (toString) {
        prepped[field] = stringify(doc[field]);
      } else {
        prepped[field] = doc[field];
      }
    });
    prepped.identifier = doc.identifier;
    prepped.interra = doc.interra;
    prepped.modified = doc.modified;
    return prepped;
  }

  push(callback) {
    callback();
  }

  insertOne(callback) {
    callback();
  }

  insertMany() {}

  update() {}

  delete() {}
}

class elasticSearch extends Search {

  init(callback) {
    this.private = this.siteInfo.getConfigItem('private');
    this.aws = this.private.aws;
    const accessKeyId = this.aws.accessKeyId;
    const secretAccessKey = this.aws.secretAccessKey;
    const region = this.aws.region;
    const esEndpoint = this.aws.es.endpoint;
    AWS.config.update({
      credentials: new AWS.Credentials(accessKeyId, secretAccessKey),
      region,
    });

    this.Client = require('elasticsearch').Client({ // eslint-disable-line
      hosts: [esEndpoint],
      connectionClass: require('http-aws-es'), // eslint-disable-line
    });
    const that = this;

    this.Client.ping({
      requestTimeout: 30000,
    }, (error) => {
      if (error) {
        callback(error);
      } else {
        that.Client.indices.delete({
          index: that.aws.es.index,
        }, (err) => {
          if (err) {
            callback(err.msg);
          } else {
            that.Client.indices.create({
              index: that.aws.es.index,
            }, (createErr) => {
              callback(createErr, !createErr);
            });
          }
        });
      }
    });
  }

  insertOne(item, callback) {
    const doc = this.prepareSearchFields(item, false);
    this.Client.create({
      index: this.aws.es.index,
      type: this.schema.getConfigItem('primaryCollection'),
      id: doc.identifier,
      body: doc,
    }, (error) => {
      callback(error, !error);
    });
  }

}

class simpleSearch extends Search {

  init(callback) {
    this.idx = [];
    callback();
  }

  insertOne(item, callback) {
    const doc = this.prepareSearchFields(item, false);
    const exp = {
      doc,
      ref: doc.interra.id,
    };
    this.idx.push(exp);
    return callback(null);
  }

  push(callback) {
    const file = path.join(this.apiDir, 'search-index.json');
    fs.outputFile(file, JSON.stringify(this.idx), (err) => {
      callback(err, !err);
    });
  }
}

class elasticLunr extends Search {

  init(callback) {
    this.idx = elasticlunr(() => {});
    // TODO: get the map for this.
    this.idx.setRef('identifier');
    this.searchConfig.fields.forEach((field) => {
      this.idx.addField(field);
    });
    callback();
  }

  insertOne(item, callback) {
    const doc = this.prepareSearchFields(item, false);
    this.idx.addDoc(doc);
    return callback(null);
  }

  push(callback) {
    const file = path.join(this.apiDir, 'search-index.json');
    fs.outputFile(file, JSON.stringify(this.idx), (err) => {
      callback(err, !err);
    });
  }
}

function type(obj) {
  return Object.prototype.toString.call(obj).match(/.* (.*)\]/)[1];
}

function stringify(obj) {
  if (type(obj) === 'Function') {
    return null;
  }
  if (type(obj) === 'Undefined') {
    return null;
  }
  if (type(obj) === 'Null') {
    return null;
  }
  if (type(obj) === 'Number') {
    return obj;
  }
  if (type(obj) === 'String') {
    return obj;
  }
  if (type(obj) === 'Object' || type(obj) === 'Array') {
    let result = '';
    Object.keys(obj).forEach((key) => {
      const val = stringify(obj[key]);
      if (val !== null) {
        result = `${result.trim()}  ${val}`;
      }
    });
    return result;
  }
  return null;
}

module.exports = {
  elasticLunr,
  simpleSearch,
  elasticSearch,
};
