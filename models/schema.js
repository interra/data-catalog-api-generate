const fs = require('fs-extra');
const YAML = require('yamljs');
const refParser = require('json-schema-ref-parser');
const Async = require('async');
const path = require('path');
const Ajv = require('ajv');
const ajv = new Ajv({schemaId: 'id', meta: false});
ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'));

class Schema {

  constructor(dir = 'schema') {
    this.dir = dir;
    this.configFile = path.join(this.dir, 'config.yml');
    if (!fs.existsSync(this.dir)) {
      throw new Error(`Schema directory: ${this.dir} does not exist.`);
    } else if (!fs.existsSync(this.configFile)) {
      throw new Error('Schema config file does not exist.');
    }
    this.Hook = require(this.dir + '/hooks/Schema.js'); // eslint-disable-line 
    this.schemas = {};
    this.refSchemas = {};
  }

  // Validate that the schema is in proper json-schema.
  // TODO: add arg for different json-schema versions.
  validateCollectionSchema(schema) {
    try {
      const valid = ajv.compile(schema);
      if (!valid.errors) {
        return true;
      }
      return false;
    } catch (e) {
      throw new Error('Schema is not valid.');
    }
  }

  validateCollectionItem(schema, item) {
    const validator = ajv.compile(schema);
    const valid = validator(item);
    if (!valid) {
      return validator.errors;
    }
    return true;
  }

  // TODO: Validates full schema:
  // - ensures collections folder
  // - validates all collections
  // - validates config.yml file
  // - ensures uiSchema.yml
  // - ensures collections + map have required files
  validateFullSchema() {

  }

  // Retrieves uiSchema.
  uiSchema() {
    const data = fs.readFileSync(path.join(this.dir, 'UISchema.yml'), 'utf8');
    return YAML.parse(data);
  }

  // Retrieves map settings.
  mapSettings() {
    const data = fs.readFileSync(path.join(this.dir, 'map.yml'), 'utf8');
    return YAML.parse(data);
  }

  // Retrieves Schema as well as uiSchema and map for individual collection.
  collectionAndSchema(collection, callback) {
    this.collection(collection, (err, list) => {
      if (err) {
        callback('Collection not found.');
      } else {
        const uiSchema = this.uiSchema();
        const map = this.mapSettings();
        const data = {
          schema: list,
          uiSchema: uiSchema[collection],
          map,
        };
        callback(null, data);
      }
    });
  }

  /**
   * Retrieves Schema for an individual collection.
   * @param {string} collection Collection to load schema from.
   * @return {object} The loaded schema.
   */
  load(collection, callback) {
    const that = this;
    const file = path.join(that.dir, 'collections', `${collection}.yml`);
    that.Hook.preLoad(file, (err, prefile) => {
      const collectionFile = fs.readFileSync(prefile, 'utf8');
      // const data = Object.assign(YAML.parse(collectionFile), {interra: YAML.parse(interraSchema)});
      const data = YAML.parse(collectionFile);
      that.Hook.postLoad(collection, data, (posterr, postData) => {
        callback(posterr, postData);
      });
    });
  }

  /**
   * Provides schema that includes 'interra-reference' for validating stored docs.
   */
  reference(collection, callback) {
    if (collection in this.refSchemas) {
      callback(null, this.refSchemas[collection]);
    } else {
      const that = this;
      this.load(collection, (err, schema) => {
        const references = this.getConfigItem('references');
        if (collection in references) {
          Async.eachOf(references[collection], (ref, field, done) => {
            if (schema.properties[field].type === 'object') {
              schema.properties[field] = { // eslint-disable-line no-param-reassign
                type: 'object',
                title: 'interra reference',
                required: ['interra-reference'],
                properties: {
                  'interra-reference': {
                    type: 'string',
                    title: 'Interra reference',
                  },
                },
              };
            } else {
              schema.properties[field] = { // eslint-disable-line no-param-reassign
                type: 'array',
                title: 'interra reference',
                items: {
                  required: ['interra-reference'],
                  properties: {
                    'interra-reference': {
                      type: 'string',
                      title: 'Interra reference',
                    },
                  },
                },
              };
            }
            done();
          }, (lerr) => {
            that.refSchemas[collection] = schema;
            callback(lerr, schema);
          });
        } else {
          callback(null, schema);
        }
      });
    }
  }

  dereference(collection, callback) {
    if (collection in this.schemas) {
      callback(null, this.schemas[collection]);
    } else {
      const that = this;
      this.load(collection, (err, schema) => {
        if (err) {
          callback(err);
        } else {
          that.Hook.preDereference(schema, (preerr, preschema) => {
            const dir = __dirname;
            const schemaDir = path.join(this.dir, 'collections');
            process.chdir(schemaDir);
            refParser.dereference(preschema)
              .then((derefSchema) => {
                process.chdir(dir);
                that.Hook.postDereference(derefSchema, (posterr, postDerefSchema) => {
                  that.schemas[collection] = postDerefSchema;
                  callback(posterr, postDerefSchema);
                });
              })
              .catch((dereferr) => {
                process.chdir(dir);
                callback(dereferr, null);
              });
          });
        }
      });
    }
  }

  getConfig() {
    const data = fs.readFileSync(this.configFile, 'utf8');
    return YAML.parse(data);
  }

  getConfigItem(item) {
    const items = this.getConfig(item);
    return items[item];
  }

  /**
   * Lists available schemas.
   * @return {array} Array of schemas.
   */
  list(callback) {
    fs.readdir(path.join(this.dir, '/../.'), (err, data) => {
      if (err) {
        callback(err);
      } else {
        callback(null, data);
      }
    });
  }
}

Schema.register = (server, options, next) => {
  next();
};

Schema.register.attributes = {
  name: 'schema',
};

module.exports = Schema;
