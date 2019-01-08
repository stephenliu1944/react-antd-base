import qs from 'qs';
import axios from 'axios';
import { isString, isFormData, isIE, isEmpty, isNotEmpty, isBlank, isNotBlank, isFunction } from '@beancommons/utils';
import { HttpMethod, ContentType } from 'constants/enum';
import { appendPrefixSlash, removeSuffixSlash, log } from 'utils/commons';

// global settings
var defaults = {
    // axios的默认参数
    method: HttpMethod.GET,
    paramsSerializer: serializeData,
    // withCredentials: true,                    // 跨域请求带认证信息，譬如 Cookie, SSL Certificates，HTTP Authentication
    transformResponse: [
        // 默认转成json格式
        function(data) {
            if (isString(data)) {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    console.error('Can not parse response data to json object, please check the data format: ', e, data);
                }
            }

            return data;
        }
    ],
    // 扩展的属性默认值
    contentType: ContentType.JSON,
    proxyURL: '/proxy',
    enableProxy: false,
    isDev: false
};

Promise.prototype.done = function(onFulfilled, onRejected) {
    this.then(onFulfilled, onRejected)
        .catch(function(reason) {
            // 抛出一个全局错误
            setTimeout(() => {
                throw reason;
            }, 0);
        });
};

Promise.prototype.finally = function(callback) {
    let P = this.constructor;
    return this.then(
        value => P.resolve(callback(value)).then(() => value),
        reason => P.resolve(callback(reason)).then(() => {
            throw reason;
        })
    );
};

function createTimestamp() {
    return new Date().getTime();
}

function serializeData(params, encode = false) {
    var data = qs.stringify(params, { allowDots: true });

    if (encode) {
        data = encodeURIComponent(data);
    }
    return data;
}

function fixBaseURL(baseURL) {
    if (baseURL) {
        baseURL = baseURL.trim();
        baseURL = removeSuffixSlash(baseURL);
    }

    return baseURL;
}

function fixURL(url) {
    if (url) {
        url = url.trim();
        url = appendPrefixSlash(url);
    }

    return url;
}

function formatOpts(opts) {
    if (!opts) {
        return;
    }

    var { baseURL, url, method, contentType } = opts;

    return Object.assign(opts, {
        baseURL: fixBaseURL(baseURL),
        url: fixURL(url),
        method: method?.toLowerCase(),
        contentType: contentType?.toLowerCase()
    });
}

function handleProxy(opts) {
    if (!opts) {
        return '';
    }

    var proxyURL = opts.proxyURL;
    // 为 url 增加代理服务拦截的path
    var baseURL = isFunction(proxyURL) ? proxyURL(opts) : proxyURL;
    // 为baseURL补充上非域名部分的rootPath, 但是 BASE_URL_REG正则有bug, 且造成代码混乱, 估暂时移除.
    // var match = baseURL?.match(BASE_URL_REG) || [];
    // baseURL = appendPrefixSlash(prefix) + appendPrefixSlash(match[4]);     
    // 请求当前dev服务
    baseURL = appendPrefixSlash(baseURL);
    return baseURL;
}

export function settings(opts) {
    Object.assign(defaults, opts);
}

export function prepare(opts, encode) {
    if (isEmpty(opts)) {
        return;
    }

    if (isBlank(opts.baseURL) && isBlank(opts.url)) {
        return;
    }

    var _opts = Object.assign({}, defaults, opts);
    var { baseURL, url, enableProxy, params } = formatOpts(_opts);

    if (enableProxy) {
        baseURL = handleProxy(_opts);
    }

    baseURL = baseURL || '';
    url = url || '';
    
    if (isNotEmpty(params)) {
        url += '?' + serializeData(params, encode);
    }

    return baseURL + url;
}

// 根据 prefix + baseURL 生成代理拦截的 url
export function proxyHost(options = {}, props = {}) {
    var { prefix = '/proxy', domain } = props;
    var { baseURL } = options;

    if (isBlank(baseURL)) {
        if (isNotBlank(domain)) {
            baseURL = domain;
        } else {
            return prefix;
        }
    }

    /**
     * 获取url的host和port部分, 此正则有缺陷, 详见顶部.
     */ 
    // var match = baseURL?.match(BASE_URL_REG) || [];
    // var host = match[2] || '';
    // var port = match[3] || '';
    // var proxyURL = host + port;

    var host = baseURL.replace(/(^http[s]?:\/\/)/, '')
        .replace(/(\/)$/, '');
        // .replace(':', '_');     

    return `${prefix}/${host}`;
}

// 正则获取baseURL中的 protocol, host, port, rootPath 部分.
// TODO: 如果baseURL格式为 '/xxx'则不能匹配到, 但是'xxx'和'xxx/'可以匹配到.
// const BASE_URL_REG = /^(https?:\/\/)?([\w-\.]+)(:[\d]{1,})?(\/[\/\w-\.\?#=%]*)*/;
export default function HttpRequest(opts) {
    if (isEmpty(opts)) {
        return Promise.reject('options is required.');
    }

    if (isBlank(opts.url)) {
        return Promise.reject('url is required.');
    }

    var preProcess;
    var _opts = Object.assign({}, defaults, opts);
    var beforeRequest = _opts.beforeRequest;
    
    formatOpts(_opts);

    // 请求前预处理
    if (beforeRequest) {
        preProcess = new Promise(function(resolve, reject) {
            beforeRequest(resolve, reject, _opts);
        });
    } else {
        preProcess = Promise.resolve(_opts);
    }

    return new Promise(function(resolve, reject) {
        preProcess.then(function(options) {
            var {
                // axios参数
                url = '',
                baseURL,
                method,
                headers,
                params,
                data,
                paramsSerializer,
                // 扩展的参数
                cache,
                cancel,
                contentType,
                returnType,
                requestInterceptor,
                responseInterceptor,
                afterResponse,
                onError,
                enableProxy,
                proxyURL,
                isDev,
                // axios其他参数
                ...other            // 注意 other
            } = options;
          
            if (isDev) {
                log({ url, baseURL, method, data, params }, 'Request');
            }
        
            if (enableProxy) {
                baseURL = handleProxy(options);
            }

            // 不缓存请求, 则在末尾增加时间搓
            if (!cache) {
                params = params || {};
                params.t = createTimestamp();
            }
            
            headers = headers || {};
            headers['X-Requested-With'] = 'XMLHttpRequest';
    
            if (method === HttpMethod.POST) {
                headers['Content-Type'] = contentType;
    
                if (isNotEmpty(data)) {
                    switch (contentType) {
                        // contentType 为 'application/x-www-form-urlencoded' 的请求将参数转化为 formData 传递
                        case ContentType.FORM_URLENCODED:
                            if (!isFormData(data)) {
                                data = serializeData(data);
                            }
                            // TODO: 更多兼容性处理.
                            break;
                    }
                }
            }
            
            const instance = axios.create();

            if (requestInterceptor) {
                instance.interceptors.request.use(function(config) {
                    return requestInterceptor(config) || config;
                }, function(error) {
                    return Promise.reject(error);
                });
            }
    
            if (responseInterceptor) {
                instance.interceptors.response.use(function(response) {
                    return responseInterceptor(response) || response;
                }, function(error) {
                    return Promise.reject(error);
                });
            }
    
            // 调用 axios 库
            instance.request({
                headers,
                method,
                baseURL,
                url,
                params,
                paramsSerializer,
                data,
                cancelToken: cancel && new axios.CancelToken(cancel),
                ...other
            }).then(function(response) {
                if (isDev) {
                    log(response.data, 'Response');
                }
    
                // 配置了响应拦截器, 自行处理 resolve 和 reject 状态.
                if (afterResponse) {
                    afterResponse(resolve, reject, response.data, options);
                } else {
                    resolve(response.data);
                }
            }).catch(function(error) {
                var errorMsg;
                // 服务端异常
                // The request was made and the server responded with a status code
                // that falls out of the range of 2xx
                if (error.response) {
                    errorMsg = error.response;
                // 浏览器抛出的异常, 比如请求超时, 不同浏览器可能有不同的行为.
                // Something happened in setting up the request that triggered an Error
                } else {
                    errorMsg = error.stack || error.message;
                }          
                
                if (isIE()) {
                    console.error(JSON.stringify(errorMsg));
                } else {
                    console.error(errorMsg);
                }
    
                onError?.(errorMsg);
    
                reject(errorMsg);
            });
        }, function(error) {
            reject(error);
        });
    });
}