'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = _interopDefault(require('fs'));
var path = _interopDefault(require('path'));
var resolve = _interopDefault(require('resolve'));
var styleInject = _interopDefault(require('style-inject'));
var sass = _interopDefault(require('node-sass'));
var rollupPluginutils = require('rollup-pluginutils');

var START_COMMENT_FLAG = '/* collect-postcss-start';
var END_COMMENT_FLAG = 'collect-postcss-end */';

var escapeRegex = function (str) { return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); };

var findRegex = new RegExp(((escapeRegex(START_COMMENT_FLAG)) + "([^]*?)" + (escapeRegex(END_COMMENT_FLAG))), 'g');
var replaceRegex = new RegExp(((escapeRegex(START_COMMENT_FLAG)) + "[^]*?" + (escapeRegex(END_COMMENT_FLAG))));
var importRegex = new RegExp('@import([^;]*);', 'g');

var importExtensions = ['.scss', '.sass'];
var injectFnName = '__$styleInject';
var injectStyleFuncCode = styleInject
    .toString()
    .replace(/styleInject/, injectFnName);

var index = function (options) {
    if ( options === void 0 ) options = {};

    var extensions = options.extensions || importExtensions;
    var filter = rollupPluginutils.createFilter(options.include || ['**/*.scss', '**/*.sass'], options.exclude);
    var extract = Boolean(options.extract);
    var extractPath = typeof options.extract === 'string' ? options.extract : null;
    var importOnce = Boolean(options.importOnce);

    var cssExtract = '';
    var visitedImports = new Set();

    return {
        name: 'collect-sass',
        intro: function intro () {
            if (extract) {
                return
            }

            return injectStyleFuncCode
        },
        transform: function transform (code, id) {
            if (!filter(id)) { return }
            if (extensions.indexOf(path.extname(id)) === -1) { return }

            var relBase = path.dirname(id);

            // Resolve imports before lossing relative file info
            // Find all import statements to replace
            var transformed = code.replace(importRegex, function (match, p1) {
                var paths = p1.split(/[,]/).map(function (p) {
                    var orgName = p.trim();  // strip whitespace
                    var name = orgName;

                    if (name[0] === name[name.length - 1] && (name[0] === '"' || name[0] === "'")) {
                        name = name.substring(1, name.length - 1);  // string quotes
                    }

                    // Exclude CSS @import: http://sass-lang.com/documentation/file.SASS_REFERENCE.html#import
                    if (path.extname(name) === '.css') { return orgName }
                    if (name.startsWith('http://')) { return orgName }
                    if (name.startsWith('url(')) { return orgName }

                    var fileName = path.basename(name);
                    var dirName = path.dirname(name);

                    // libsass's file name resolution: https://github.com/sass/node-sass/blob/1b9970a/src/libsass/src/file.cpp#L300
                    if (fs.existsSync(path.join(relBase, dirName, fileName))) {
                        var absPath = path.join(relBase, name);

                        if (importOnce && visitedImports.has(absPath)) {
                            return null
                        }

                        visitedImports.add(absPath);
                        return ("'" + absPath)
                    }

                    if (fs.existsSync(path.join(relBase, dirName, ("_" + fileName)))) {
                        var absPath$1 = path.join(relBase, ("_" + name));

                        if (importOnce && visitedImports.has(absPath$1)) {
                            return null
                        }

                        visitedImports.add(absPath$1);
                        return ("'" + absPath$1 + "'")
                    }

                    for (var i = 0; i < importExtensions.length; i++) {
                        var absPath$2 = path.join(relBase, dirName, ("_" + fileName + (importExtensions[i])));

                        if (fs.existsSync(absPath$2)) {
                            if (importOnce && visitedImports.has(absPath$2)) {
                                return null
                            }

                            visitedImports.add(absPath$2);
                            return ("'" + absPath$2 + "'")
                        }
                    }

                    for (var i = 0; i < importExtensions.length; i++) {
                        var absPath$3 = path.join(relBase, ("" + name + (importExtensions[i])));

                        if (fs.existsSync(absPath$3)) {
                            if (importOnce && visitedImports.has(absPath$3)) {
                                return null
                            }

                            visitedImports.add(absPath$3);
                            return ("'" + absPath$3 + "'")
                        }
                    }

                    var nodeResolve;

                    try {
                        nodeResolve = resolve.sync(path.join(dirName, ("_" + fileName)), { extensions: extensions });
                    } catch (e) {}

                    if (nodeResolve) {
                        if (importOnce && visitedImports.has(nodeResolve)) {
                            return null
                        }

                        visitedImports.add(nodeResolve);
                        return ("'" + nodeResolve + "'")
                    }

                    try {
                        nodeResolve = resolve.sync(path.join(dirName, fileName), { extensions: extensions });
                    } catch (e) {}

                    if (nodeResolve) {
                        if (importOnce && visitedImports.has(nodeResolve)) {
                            return null
                        }

                        visitedImports.add(nodeResolve);
                        return ("'" + nodeResolve + "'")
                    }

                    console.error(("Unresolved path in " + id + ": " + name));
                });

                var uniquePaths = paths.filter(function (p) { return p !== null; });

                if (uniquePaths.length) {
                    return ("@import " + (uniquePaths.join(', ')) + ";")
                }

                return ''
            });

            // Add sass imports to bundle as JS comment blocks
            return {
                code: START_COMMENT_FLAG + transformed + END_COMMENT_FLAG,
                map: { mappings: '' },
            }
        },
        transformBundle: function transformBundle (source) {
            // Reset paths
            visitedImports = new Set();

            // Extract each sass file from comment blocks
            var accum = '';
            var match = findRegex.exec(source);

            while (match !== null) {
                accum += match[1];
                match = findRegex.exec(source);
            }

            // Transform sass
            var css = sass.renderSync({
                data: accum,
            }).css.toString();

            if (!extract) {
                var injected = injectFnName + "(" + (JSON.stringify(css)) + ");";

                // Replace first instance with output. Remove all other instances
                return source.replace(replaceRegex, injected).replace(findRegex, '')
            }

            // Store css for writing
            cssExtract = css;

            // Remove all other instances
            return source.replace(findRegex, '')
        },
        onwrite: function onwrite(opts) {
            if (extract) {
                return new Promise(function (resolve$$1, reject) {
                    var destPath = extractPath ?
                        extractPath :
                        path.join(
                            path.dirname(opts.dest),
                            path.basename(opts.dest, path.extname(opts.dest)) + '.css'
                        );

                    fs.writeFile(destPath, cssExtract, function (err) {
                        if (err) { reject(err); }
                        resolve$$1();
                    });
                })
            }
        }
    }
};

module.exports = index;