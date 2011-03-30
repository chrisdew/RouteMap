/**
 * <p>RouteMap holds an internal table of route patterns and method names in addition to some
 * adding/removing/utility methods and a handler for request routing.</p>
 * <p>It does not have any dependencies and is written in "plain old" JS, but it does require JS 1.8 array methods, so
 * if the environment it will run in does not have those, the reference implementations from
 * <a href="https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/array/">Mozilla</a> should be
 * supplied external to this library.</p>
 * <p>It is designed to be used in both a browser setting and a server-side context (for example in node.js).</p>
 * <strong>LICENSING INFORMATION:</strong>
 * <blockquote><pre>
 * Copyright 2011 OpenGamma Inc. and the OpenGamma group of companies
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * </pre></blockquote>
 * @see <a href="http://www.opengamma.com/">OpenGamma</a>
 * @see <a href="http://www.apache.org/licenses/LICENSE-2.0">Apache License, Version 2.0</a>
 * @see <a href="https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/array/">Mozilla Developer
 * Network</a>
 * @name RouteMap
 * @namespace RouteMap
 * @author Afshin Darian
 * @static
 * @throws {Error} if JS 1.8 Array.prototype methods don't exist
 */
(function (pub) { // resides in pub.RouteMap, defaults to exports for CommonJS or window if exports does not exist
    (function (arr, url) { // plain old JS, but needs some JS 1.8 array methods
        if (!arr.every || !arr.filter || !arr.indexOf || !arr.map || !arr.reduce || !arr.some)
            throw new Error('See ' + url + ' for reference versions of Array.prototype methods available in JS 1.8');
    })([], 'https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/array/');
    var namespace = 'RouteMap', routes, // internal reference to RouteMap
        active_routes = {}, added_routes = {}, flat_pages = [],
        last = 0, current = 0,
        EQ = '-' /* equal string */, SL = '/' /* slash string */, PR = '#' /* default prefix string */,
        encode = encodeURIComponent, decode = decodeURIComponent,
        token_exp = /\*|:|\?/, star_exp = /(^([^\*:\?]+):\*)|(^\*$)/, scalar_exp = /^:([^\*:\?]+)(\??)$/,
        keyval_exp = /^([^\*:\?]+):(\??)$/, trailing_slash_exp = new RegExp('([^' + SL + '])$'),
        prefix_exp = new RegExp('^' + PR),
        context = typeof window !== 'undefined' ? window : {}, // where listeners reside, routes.context() overwrites it
        /** @ignore */
        invalid_str = function (str) {return typeof str !== 'string' || !str.length;},
        /** @ignore */
        has_star = function (arr) {return arr.some(function (val) {return !!val.rules.star;});},
        /** @ignore */
        fingerprint = function (rule) {return [rule.method, rule.route].join('|');},
        /**
         * parses a path and returns a list of objects that contain argument dictionaries, methods, and raw hash values
         * @name RouteMap#parse
         * @inner
         * @function
         * @type Array
         * @returns {Array} a list of parsed objects in descending order of matched hash length
         * @throws {TypeError} if the method specified by a rule specification does not exist during parse time
         */
        parse = function (path) {
            // go with the first matching page (longest) or any pages with * rules
            var self = 'parse', pages = flat_pages.filter(function (val) { // add slash to paths so all vals match
                    trailing_slash_exp.exec(path); // this populates RegExp.$1 because replace won't
                    return ~path.replace(trailing_slash_exp, RegExp.$1 + SL).indexOf(val);
                }).filter(function (page, index) {return !index || has_star(active_routes[page]);});
            return !pages.length ? [] : pages.reduce(function (acc, page) { // flatten parsed rules for all pages
                var current_page = active_routes[page].map(function (rule_set) {
                    var args = {}, scalars = rule_set.rules.scalars, keyvals = rule_set.rules.keyvals, method,
                        // populate the current request object as a collection of keys/values and scalars
                        request = path.replace(page, '').split(SL).reduce(function (acc, val) {
                            var split = val.split(EQ), key = split[0], value = split.slice(1).join(EQ);
                            return !val.length ? acc // discard empty values, separate rest into scalars or keyvals
                                : (value ? acc.keyvals[key] = value : acc.scalars.push(val)) && acc;
                        }, {keyvals: {}, scalars: []}), star, keyval,
                        keyval_names = keyvals.reduce(function (acc, val) {return (acc[val.name] = 0) || acc;}, {}),
                        required_scalars_length = scalars.filter(function (val) {return val.required;}).length,
                        required_keyvals = keyvals.filter(function (val) {return val.required;})
                            .every(function (val) {return val.name in request.keyvals;});
                    // not enough parameters are supplied in the request for this rule
                    if (required_scalars_length > request.scalars.length || !required_keyvals) return 0;
                    if (!rule_set.rules.star){ // too many params are only a problem if the rule isn't a wildcard
                        if (request.scalars.length > scalars.length) return 0; // if too many scalars are supplied
                        for (keyval in request.keyvals) // if too many keyvals are supplied
                            if (request.keyvals.hasOwnProperty(keyval) && !(keyval in keyval_names)) return 0;
                    };
                    request.scalars.slice(0, scalars.length) // populate args scalars
                        .forEach(function (scalar, index) {args[scalars[index].name] = decode(scalar);});
                    keyvals.forEach(function (keyval) { // populate args keyvals
                        if (request.keyvals[keyval.name]) args[keyval.name] = decode(request.keyvals[keyval.name]);
                        delete request.keyvals[keyval.name]; // remove so that * can be constructed
                    });
                    if (rule_set.rules.star){ // all unused scalars and keyvals go into the * argument (still encoded)
                        star = request.scalars.slice(scalars.length, request.scalars.length);
                        for (keyval in request.keyvals) if (request.keyvals.hasOwnProperty(keyval))
                            star.push([keyval, request.keyvals[keyval]].join(EQ));
                        args[rule_set.rules.star] = star.join(SL);
                    };
                    try{ // make sure the rule's method actually exists and can be accessed
                        method = rule_set.method.split('.').reduce(function (acc, val) {return acc[val];}, context);
                        if (typeof method !== 'function') throw new Error();
                    }catch(error){
                        throw new TypeError(self + ': ' + rule_set.method + ' is not a function');
                    };
                    return {page: page, hash: routes.hash({route: rule_set.raw}, args), method: method, args: args};
                });
                return acc.concat(current_page).filter(Boolean); // only return the parsed rules that matched
            }, []).sort(function (a, b) {return b.hash.length - a.hash.length;}); // order in descending hash length
        },
        /**
         * builds the internal representation of a rule based on the route definition
         * @inner
         * @name RouteMap#compile
         * @function
         * @param {String} route
         * @throws {SyntaxError} if any portion of a rule definition follows a <code>*</code> directive
         * @throws {SyntaxError} if a required scalar follows an optional scalar
         * @throws {SyntaxError} if a rule cannot be parsed
         * @type {Object}
         * @returns {Object} a compiled object, for example, the rule <code>'/foo/:id/type:?/rest:*'</code> would return
         * an object of the form: <blockquote><pre>{
         *     page:'/foo',
         *     rules:{
         *         keyvals:[{name: 'type', required: false}],
         *         scalars:[{name: 'id', required: true}],
         *         star:'rest' // false if not defined
         *     }
         * }
         * @see RouteMap.add
         * @see RouteMap.hash
         * @see RouteMap.remove
         */
        compile = (function () {
            var memo = {}; // compile is slow so cache compiled objects here
            return function (route) {
                var self = 'compile', param, compiled_route, orig = route;
                route = route[0] === SL ? route : ~route.indexOf(SL) ? route.slice(route.indexOf(SL)) : null;
                if (!route) throw new SyntaxError(self + ': the route "' + orig + '" was not understood');
                if (route in memo) return memo[route];
                compiled_route = route.split(SL).reduce(function (acc, val) {
                    var rules = acc.rules, scalars = rules.scalars, keyvals = rules.keyvals;
                    if (rules.star) throw new SyntaxError(self + ': no rules can follow a * directive');
                    // construct the name of the page
                    if (!~val.search(token_exp) && !scalars.length && !keyvals.length) return acc.page.push(val) && acc;
                    // construct the parameters
                    if (val.match(star_exp)) return (rules.star = RegExp.$2 || RegExp.$3) && acc;
                    if (val.match(scalar_exp)){
                        if (!RegExp.$2 && acc.last_optional) // required scalars cannot follow optional scalars
                            throw new SyntaxError(self + ': "' + val + '" cannot follow an optional rule');
                        if (!!RegExp.$2) acc.last_optional = val;
                        return scalars.push({name: RegExp.$1, required: !RegExp.$2}) && acc;
                    };
                    if (val.match(keyval_exp)) return keyvals.push({name: RegExp.$1, required: !RegExp.$2}) && acc;
                    throw new SyntaxError(self + ': the rule "' + val + '" was not understood');
                }, {page: [], rules: {scalars: [], keyvals: [], star: false}, last_optional: ''});
                delete compiled_route.last_optional; // this is just a temporary value and should not be exposed
                compiled_route.page = compiled_route.page.join(SL).replace(new RegExp(SL + '$'), '') || SL;
                return memo[route] = compiled_route;
            };
        })();
    return pub[namespace] = (routes) = { // parens around routes to satisfy JSDoc's caprice
        /**
         * adds a rule to the internal table of routes and methods
         * @name RouteMap.add
         * @function
         * @type undefined
         * @param {Object} rule rule specification
         * @param {String} rule.route route pattern definition; there are three types of pattern arguments: scalars,
         * keyvals, and stars; scalars are individual values in a URL (all URL values are separate by the
         * <code>'/'</code> character), keyvals are named values, e.g. 'foo-bar', and star values are wildcards; so for
         * example, the following pattern represents all the possible options:<blockquote>
         * <code>'/foo/:id/:sub?/attr:/subattr:?/rest:*'</code></blockquote>the <code>?</code> means that argument is
         * optional, the star rule is named <code>rest</code> but it could have just simply been left as <code>*</code>,
         * which means the resultant dictionary would have put the wildcard remainder into <code>args['*']</code>
         * instead of <code>args.rest</code>; so the following URL would match the pattern above:<blockquote>
         * <code>/foo/23/45/attr-something/subattr-something_else</code></blockquote>
         * when its method is called, it will receive this arguments dictionary:<blockquote>
         * <code><pre>{
         *      id:'23',
         *      subid:'45',
         *      attr:'something',
         *      subattr:'something_else',
         *      rest:''
         * }</pre></code></blockquote>
         * <code>add</code> uses {@link #compile} and does not catch any errors thrown by that function
         * @param {String} rule.method listener method for this route
         * @throws {TypeError} if <code>rule.route</code> or <code>rule.method</code> are not strings or empty strings
         * @throws {Error} if <code>rule</code> has already been added
         * @see RouteMap.post_add
         */
        add: function (rule) {
            var self = 'add', method = rule.method, route = rule.route, compiled, id = fingerprint(rule);
            if ([route, method].some(invalid_str))
                throw new TypeError(self + ': rule.route and rule.method must both be non-empty strings');
            if (id in added_routes) throw new Error(self + ': ' + route + ' to ' + method + ' already exists');
            compiled = compile(route);
            added_routes[id] = 0;
            if (!active_routes[compiled.page] && (active_routes[compiled.page] = [])) // add route to list and sort
                flat_pages = flat_pages.concat(compiled.page).sort(function (a, b) {return b.length - a.length;});
            active_routes[compiled.page].push(routes.post_add({method: method, rules: compiled.rules, raw: route}));
        },
        /**
         * overrides the context where listener methods are sought, the default scope is <code>window</code>
         * (in a browser setting)
         * @name RouteMap.context
         * @function
         * @type undefined
         * @param {Object} scope the scope within which methods for mapped routes will be looked for
         * @throws {TypeError} if <code>scope</code> is falsey
         */
        context: function (scope) {if (scope) context = scope; else throw new TypeError('context: scope is falsey');},
        /**
         * returns the parsed (see {@link #parse}) currently accessed route; after listeners have finished
         * firing, <code>current</code> and <code>last</code> are the same
         * @name RouteMap.current
         * @function
         * @type Object
         * @returns {Object} the current parsed URL object
         * @see RouteMap.last
         */
        current: function () {return current;},
        /**
         * URL grabber function, defaults to checking the URL fragment (<code>hash</code>); this function should be
         * overwritten in a server-side environment; this method is called by {@link RouteMap.handler}; without
         * <code>window.location.hash</code> it will return <code>'/'</code>
         * @name RouteMap.get
         * @function
         * @returns {String} by default, this returns a subset of the URL hash (everything after the first
         * <code>'/'</code> character ... if nothing follows a slash, it returns <code>'/'</code>); if overwritten, it
         * must be a function that returns URL path strings (beginning with <code>'/'</code>) to match added rules
         * @type String
         */
        get: function () {
            if (typeof window === 'undefined') return SL;
            var hash = window.location.hash, index = hash.indexOf(SL);
            return ~index ? hash.slice(index) : SL;
        },
        /**
         * in a browser setting, it changes <code>window.location.hash</code>, in other settings, it should be
         * overwritten to do something useful (if necessary); it will not throw an error if <code>window</code> does
         * not exist
         * @name RouteMap.go
         * @function
         * @type undefined
         * @param {String} hash the hash fragment to go to
         */
        go: function (hash) {
            if (typeof window !== 'undefined') window.location.hash = (hash.indexOf(PR) === 0 ? '' : PR) +  hash;
        },
        /**
         * main handler function for routing, this should be bound to <code>hashchange</code> events in the browser, or
         * (in conjunction with updating {@link RouteMap.get}) used with the HTML5 <code>history</code> API, it detects
         * all the matching route patterns, parses the URL parameters and fires their methods with the arguments from
         * the parsed URL; the timing of {@link RouteMap.current} and {@link RouteMap.last} being set is as follows
         * (pseudo-code):
         * <blockquote><pre>
         * path: get_route             // {@link RouteMap.get}
         * parsed: parse path          // {@link #parse}
         * current: longest parsed     // {@link RouteMap.current}
         * parsed: pre_dispatch parsed // {@link RouteMap.pre_dispatch}
         * current: longest parsed     // reset current
         * fire matched rules in parsed
         * last: current               // {@link RouteMap.last}
         * </pre></blockquote>
         * <code>RouteMap.handler</code> calls {@link #parse} and does not catch any errors that function throws
         * @name RouteMap.handler
         * @function
         * @type undefined
         * @see RouteMap.pre_dispatch
         */
        handler: function () {
            var parsed = parse(routes.get());
            if (parsed.length) current = parsed[0]; // set current to the longest hash before pre_dispatch touches it
            parsed = routes.pre_dispatch(parsed); // pre_dispatch might change the contents of parsed
            if (parsed.length) current = parsed[0]; // set current to the longest hash again after pre_dispatch
            parsed.forEach(function (val) {val.method(val.args);}); // fire requested methods with params from URL
            if (parsed.length) last = parsed[0]; // set last to the longest hash
        },
        /**
         * returns a URL fragment by applying parameters to a rule; uses {@link #compile} and does not catch any errors
         * thrown by that function
         * @name RouteMap.hash
         * @function
         * @type String
         * @param {Object} rule the rule specification; it typically looks like: <blockquote>
         * <code>{route:'/foo', method:'bar'}</code></blockquote> but only <code>route</code> is strictly necessary
         * @param {Object} params a dictionary of argument key/value pairs required by the rule
         * @returns {String} URL fragment resulting from applying arguments to rule pattern
         * @throws {TypeError} if a required parameter is not present
         */
        hash: function (rule, params) {
            var self = 'hash', hash, compiled, params = params || {};
            if (invalid_str(rule.route)) throw new TypeError(self + ': rule.route must be a non-empty string');
            compiled = compile(rule.route);
            hash = compiled.page + (compiled.page === SL ? '' : SL) + // 1. start with page, then add params
                compiled.rules.scalars.map(function (val) { // 2. add scalar values next
                    var value = encode(params[val.name]), bad_param = params[val.name] === void 0 || invalid_str(value);
                    if (val.required && bad_param) throw new TypeError(self + ': params.' + val.name + ' is undefined');
                    return bad_param ? 0 : value;
                })
                .concat(compiled.rules.keyvals.map(function (val) { // 3. then concat keyval values
                    var value = encode(params[val.name]), bad_param = params[val.name] === void 0 || invalid_str(value);
                    if (val.required && bad_param) throw new TypeError(self + ': params.' + val.name + ' is undefined');
                    return bad_param ? 0 : val.name + EQ + value;
                }))
                .filter(Boolean).join(SL); // remove empty (0) values
            if (compiled.rules.star && params[compiled.rules.star]) // 4. add star value if it exists
                hash += (hash[hash.length - 1] === SL ? '' : SL) + params[compiled.rules.star];
            return hash;
        },
        /**
         * returns the parsed (see {@link #parse}) last accessed route; when route listeners are being called,
         * <code>last</code> is the previously accessed route, after listeners have finished firing, the current parsed
         * route replaces <code>last</code>'s value
         * @name RouteMap.last
         * @function
         * @type Object
         * @returns {Object} the current parsed URL object
         * @see RouteMap.current
         */
        last: function () {return last;},
        /**
         * parses a URL fragment into a data structure only if there is a route whose pattern matches the fragment
         * @name RouteMap.parse
         * @function
         * @type Object
         * @returns {Object} of the form: <blockquote><code>{page:'/foo', args:{bar:'some_value'}}</code></blockquote>
         * only if a rule with the route: <code>'/foo/:bar'</code> has already been added
         * @throws {TypeError} if hash is not a string, is empty, or does not contain a <code>'/'</code> character
         * @throws {SyntaxError} if hash cannot be parsed by {@link #parse}
         */
        parse: function (hash) {
            var self = 'parse', parsed;
            hash = ~hash.indexOf(SL) ? hash.slice(hash.indexOf(SL)) : '';
            if (invalid_str(hash)) throw new TypeError(self + ': hash must be a string with a ' + SL + ' character');
            if (!(parsed = parse(hash)).length) throw new SyntaxError(self + ': ' + hash + ' cannot be parsed');
            return {page: parsed[0].page, args: parsed[0].args};
        },
        /**
         * this function is called by {@link RouteMap.add}, it receives a compiled rule object, e.g. for the rule:
         * <blockquote><code>{route:'/foo/:id/:sub?/attr:/subattr:?/rest:*', method:'console.log'}</code></blockquote>
         * <code>post_add</code> would receive the following object:
         * <blockquote><code><pre>{
         *     method:'console.log',
         *     rules:{
         *         scalars:[{name:'id',required:true},{name:'sub',required:false}],
         *         keyvals:[{name:'attr',required:true},{name:'subattr',required:false}],
         *         star:'rest'
         *     },
         *     raw:'/foo/:id/:sub?/attr:/subattr:?/rest:*'
         * }</pre></code></blockquote>
         * and it is expected to pass back an object of the same format; it can be overwritten to post-process added
         * rules e.g. to add extra default application-wide parameters; by default, it simply returns what was passed
         * into it
         * @name RouteMap.post_add
         * @function
         * @type Object
         * @returns {Object} the default function returns the exact object it received; a custom function needs to
         * an object that is of the same form (but could possibly have more or fewer parameters, etc.)
         * @param {Object} compiled the compiled rule
         */
        post_add: function (compiled) {return compiled;},
        /**
         * like {@link RouteMap.post_add} this function can be overwritten to add application-specific code into
         * route mapping, it is called before a route begins being dispatched to all matching rules; it receives the
         * list of matching parsed route objects ({@link #parse}) and is expected to return it; one application of this
         * function might be to set application-wide variables like debug flags
         * @name RouteMap.pre_dispatch
         * @function
         * @type Array
         * @returns {Array} a list of the same form as the one it receives
         * @param {Array} parsed the parsed request
         */
        pre_dispatch: function (parsed) {return parsed;},
        /**
         * if a string is passed in, it overwrites the prefix that is removed from each URL before parsing; primarily
         * used for hashbang (<code>#!</code>); either way, it returns the current prefix
         * @name RouteMap.prefix
         * @function
         * @type String
         * @returns {String} the prefix currently in use (if being replaced, it returns the new prefix)
         * @param {String} prefix (optional) the prefix string
         */
        prefix: function (prefix) {return PR = (prefix + '' || typeof prefix === 'string' ? prefix : PR);},
        /**
         * counterpart to {@link RouteMap.add}, removes a rule specification; * <code>remove</code> uses
         * {@link #compile} and does not catch any errors thrown by that function
         * @name RouteMap.remove
         * @function
         * @type undefined
         * @param {Object} rule the rule specification that was used in {@link RouteMap.add}
         * @throws {TypeError} if <code>rule.route</code> or <code>rule.method</code> are not strings or empty strings
         */
        remove: function (rule) {
            var self = 'remove', method = rule.method, route = rule.route, compiled, id = fingerprint(rule), index;
            if ([route, method].some(invalid_str))
                throw new TypeError(self + ': rule.route and rule.method must both be non-empty strings');
            if (!(id in added_routes)) return;
            compiled = compile(route);
            delete added_routes[id];
            active_routes[compiled.page] = active_routes[compiled.page]
                .filter(function (rule) {return (rule.raw !== route) || (rule.method !== method);});
            if (!active_routes[compiled.page].length && (delete active_routes[compiled.page])) // delete active route
                if (~(index = flat_pages.indexOf(compiled.page))) flat_pages.splice(index, 1); // then flat page
        }
    };
})(typeof exports === 'undefined' ? window : exports);