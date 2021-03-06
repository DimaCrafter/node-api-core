const ms = require('ms');
const cfgArg = process.argv.indexOf('--cfg');

let configPath = process.cwd() + '/config';
if (cfgArg !== -1) {
    configPath = process.argv[cfgArg + 1];
    if (!configPath.startsWith('/')) configPath = process.cwd() + '/' + configPath;
}

delete require.cache[configPath];

const config = require(configPath);
config.port = config.port || 8081;
config.isDev = process.argv.indexOf('--dev') !== -1;

if (config.isDev) {
    if (config.dev) {
        (function merge (target, source) {
            Object.keys(source).forEach(key => {
                if (typeof source[key] === 'object') {
                    if (!target[key]) target[key] = source[key] instanceof Array ? [] : {};
                    merge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            });
        })(config, config.dev);
    }

    config.ignore = config.ignore || [];
    if (!~config.ignore.indexOf('node_modules')) config.ignore.push('node_modules');
}

if (config.session) {
    config.session.ttl = config.session.ttl || '3d';
    if (typeof config.session.ttl == 'string') config.session.ttl = ms(config.session.ttl);
}

delete config.dev;
if (config.port == '$env') config.port = process.env.PORT;
module.exports = config;
