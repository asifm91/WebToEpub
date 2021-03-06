/*
  Makes HTML calls using Fetch API
*/
"use strict";

class FetchErrorHandler {
    constructor() {
    }

    makeFailMessage(url, error) {
        return chrome.i18n.getMessage("htmlFetchFailed", [url, error]);
    }

    makeFailCanRetryMessage(url, error) {
        return this.makeFailMessage(url, error) + " " +
            chrome.i18n.getMessage("httpFetchCanRetry");
    }

    getCancelButtonText() {
        return chrome.i18n.getMessage("__MSG_button_error_Cancel__");
    }

    onFetchError(url, error) {
        return Promise.reject(new Error(this.makeFailMessage(url, error.message)));
    }

    onResponseError(url, handler, response) {
        let failError = new Error(this.makeFailMessage(url, response.status));
        if ((response.status < 500) || (600 <= response.status)) {
            return Promise.reject(failError);
        }

        let msg = new Error(new Error(this.makeFailCanRetryMessage(url, response.status)));
        let cancelLabel = this.getCancelButtonText();
        return new Promise(function(resolve, reject) {
            msg.retryAction = () => resolve(HttpClient.wrapFetchImpl(url, handler, this));
            msg.cancelAction = () => reject(failError);
            msg.cancelLabel = cancelLabel;
            ErrorLog.showErrorMessage(msg);
        });
    }
}

class FetchImageErrorHandler extends FetchErrorHandler{
    constructor(parentPageUrl) {
        super();
        this.parentPageUrl = parentPageUrl;
    }

    makeFailMessage(url, error) {
        return chrome.i18n.getMessage("imageFetchFailed", [url, this.parentPageUrl, error]);
    }

    getCancelButtonText() {
        return chrome.i18n.getMessage("__MSG_button_error_Skip__");
    }
}

class HttpClient {
    constructor() {
    }

    static makeOptions() {
        return { credentials: "include" };
    }

    static wrapFetch(url, fetchOptions) {
        if (fetchOptions == null) {
            fetchOptions = {
                errorHandler: new FetchErrorHandler()
            }
        }
        if (fetchOptions.errorHandler == null) {
            fetchOptions.errorHandler = new FetchErrorHandler();
        }
        let responseHandler = new FetchResponseHandler();
        if (fetchOptions.makeTextDecoder != null) {
            responseHandler.makeTextDecoder = fetchOptions.makeTextDecoder;
        }
        let wrapOptions = {
            responseHandler: responseHandler,
            errorHandler: fetchOptions.errorHandler
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static fetchJson(url, fetchOptions) {
        let wrapOptions = {
            responseHandler: new FetchJsonResponseHandler(),
            fetchOptions: fetchOptions
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static fetchText(url) {
        let wrapOptions = {
            responseHandler: new FetchTextResponseHandler(),
        };
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    static wrapFetchImpl(url, wrapOptions) {
        let handler = wrapOptions.responseHandler;
        let errorHandler = wrapOptions.errorHandler;
        let fetchOptions = wrapOptions.fetchOptions;
        if (fetchOptions == null) {
            fetchOptions = HttpClient.makeOptions(); 
        }
        if (errorHandler == null) {
            errorHandler = new FetchErrorHandler();
        }
        return fetch(url, fetchOptions).
        catch(function (error) {
            return errorHandler.onFetchError(url, error);
        }).then(function(response) {
            return HttpClient.checkResponseAndGetData(url, handler, response, errorHandler);
        });
    }

    static checkResponseAndGetData(url, handler, response, errorHandler) {
        if(!response.ok) {
            return errorHandler.onResponseError(url, handler, response);
        } else {
            handler.setResponse(response);
            return handler.extractContentFromResponse(response);
        }
    }
}

class FetchResponseHandler {
    isHtml() {
        return this.contentType.startsWith("text/html");
    }

    setResponse(response) {
        this.response = response;
        this.contentType = response.headers.get("content-type");
    }

    extractContentFromResponse(response) {
        if (this.isHtml()) {
            return this.responseToHtml(response);
        } else {
            return this.responseToBinary(response);
        }
    }

    responseToHtml(response) {
        return response.arrayBuffer().then(function(rawBytes) {
            let data = this.makeTextDecoder(response).decode(rawBytes);
            let html = new DOMParser().parseFromString(data, "text/html");
            util.setBaseTag(this.response.url, html);
            this.responseXML = html;
            return this;
        }.bind(this));
    }

    responseToBinary(response) {
        return response.arrayBuffer().then(function(data) {
            this.arrayBuffer = data;
            return this;
        }.bind(this));
    }

    responseToText(response) {
        return response.arrayBuffer().then(function(rawBytes) {
            return this.makeTextDecoder(response).decode(rawBytes);
        }.bind(this));
    }

    responseToJson(response) {
        return response.text().then(function(data) {
            this.json =  JSON.parse(data);
            return this;
        }.bind(this));
    }

    makeTextDecoder(response) {
        let utflabel = this.charsetFromHeaders(response.headers);
        return new TextDecoder(utflabel);
    }

    charsetFromHeaders(headers) {
        let contentType = headers.get("Content-Type");
        if (!util.isNullOrEmpty(contentType)) {
            let pieces = contentType.toLowerCase().split("charset=");
            if (2 <= pieces.length) {
                return pieces[1].split(";")[0].replace(/\"/g, "").trim();
            }
        }
        return FetchResponseHandler.DEFAULT_CHARSET;
    }
}
FetchResponseHandler.DEFAULT_CHARSET = "utf-8"

class FetchJsonResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToJson(response);
    }
}

class FetchTextResponseHandler extends FetchResponseHandler {
    constructor() {
        super();
    }

    extractContentFromResponse(response) {
        return super.responseToText(response);
    }
}
