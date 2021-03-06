var hat = require('hat');
import {EventEmitter} from 'events';

interface IIncommingMessagesListener {
    handler: (payload: IMessage) => void;
    shouldProcess: (payload: IMessage) => boolean;
    disconnectHandler: () => void;
}

export interface IMessage {
    clientMsgId: string;
    payloadType: number;
    payload?: any;
}

export interface IMessageWOMsgId {
    payloadType: number;
    payload?: any;
}

export interface IConnectionParams {
    encodeDecode: any
    protocol: any;
    onPushEvent?: (message: IMessageWOMsgId) => void;
}

export class Connect extends EventEmitter {

    private adapter: any;
    private encodeDecode: any;
    private protocol: any;
    private _isConnected = false;
    private incomingMessagesListeners: IIncommingMessagesListener[] = [];
    private handlePushEvent: (message: IMessageWOMsgId) => void;
    private callbacksOnConnect: (() => void)[] = [];

    constructor(params: IConnectionParams) {
        super();

        this.encodeDecode = params.encodeDecode;
        this.protocol = params.protocol;

        this.handlePushEvent = params.onPushEvent;

        this.initialization();
    }

    public getAdapter() {
        return this.adapter;
    }

    public setAdapter(adapter: any) {
        this.adapter = adapter;
    }

    private initialization() {
        this.encodeDecode.registerDecodeHandler(
            this.onMessage.bind(this)
        );
    }

    public start(): JQueryPromise<void> {
        var def = $.Deferred<void>();

        var adapter = this.adapter;
        adapter.onOpen = () => {
            this.onOpen();
            def.resolve();
        };
        adapter.onData = this.onData.bind(this);
        adapter.onError = adapter.onEnd = (e) => {
            def.reject();
            this._onEnd(e);
        };

        adapter.connect();

        return def.promise();
    }

    private onData(data) {
        this.encodeDecode.decode(data);
    }

    private onOpen() {
        this._isConnected = true;

        this.onConnect();

        this.callbacksOnConnect.forEach(fn => fn());

        this.callbacksOnConnect = [];
    }

    public sendGuaranteedCommand(payloadType: number, params) {
        return this.sendGuaranteedCommandWithPayloadtype(payloadType, params).then(msg => msg.payload);
    }

    public sendCommand(payloadType: number, params) {
        return this.sendCommandWithPayloadtype(payloadType, params).then(msg => msg.payload);
    }

    private send(data) {
        this.adapter.send(
            this.encodeDecode.encode(data)
        );
    }

    private onMessage(data) {
        data = this.protocol.decode(data);
        var msg = data.msg;
        var payloadType = data.payloadType;
        var clientMsgId = data.clientMsgId;

        if (clientMsgId) {
            this.processData(clientMsgId, payloadType, msg);
        } else {
            this.processPushEvent(msg, payloadType);
        }
    }

    private processData(clientMsgId, payloadType, msg) {
        var isProcessed = false;

        var message = {
            clientMsgId: clientMsgId,
            payloadType: payloadType,
            payload: msg
        };

        this.incomingMessagesListeners.forEach(listener => {
            if (listener.shouldProcess(message)) {
                isProcessed = true;
                listener.handler(message);
            }
        });

        if (!isProcessed) {
            this.processPushEvent(msg, payloadType);
        }
    }

    protected isError(payloadType): boolean {
        //Overwrite this method by your buisness logic
        return false;
    }

    protected processMessage(command, msg, payloadType) {
        if (this.isError(payloadType)) {
            command.fail(msg);
        } else {
            command.done(msg);
        }
    }

    protected processPushEvent(msg, payloadType) {
        if (this.handlePushEvent) {
            this.handlePushEvent({payload: msg, payloadType});
        }
        
        this.emit(payloadType, msg);
    }

    private _onEnd(e) {
        this._isConnected = false;
        this.onEnd(e);
        this.incomingMessagesListeners.forEach(listener => {
            listener.disconnectHandler();
        });
        this.incomingMessagesListeners = [];
    }

    public isDisconnected() {
        return !this._isConnected;
    }

    public isConnected() {
        return this._isConnected;
    }
    
    private addIncomingMessagesListener (fnToAdd: IIncommingMessagesListener) {
        this.incomingMessagesListeners.push(fnToAdd);
    }

    private removeIncomingMesssagesListener(fnToRemove: IIncommingMessagesListener) {
        this.incomingMessagesListeners = this.incomingMessagesListeners.filter(fn => fn != fnToRemove);
    }

    public sendCommandWithoutResponse(payloadType: number, payload: Object) {
        this.send(this.protocol.encode(payloadType, payload, hat()));
    }

    public sendMultiresponseCommand(payloadType: number, payload: Object, onMessage: (data) => boolean, onError?: () => void) {
        var msgId = hat();

        var incomingMessagesListener = {
            handler: (msg) => {
                var shouldUnsubscribe = onMessage(msg);

                if (shouldUnsubscribe) {
                    this.removeIncomingMesssagesListener(incomingMessagesListener);
                }
            },
            shouldProcess: msg => msg.clientMsgId == msgId,
            disconnectHandler: () => {
                if (onError) {
                    this.removeIncomingMesssagesListener(incomingMessagesListener);
                    onError();
                }
            }
        }

        this.addIncomingMessagesListener(incomingMessagesListener);

        if (this.isConnected()) {
            try {
                this.send(this.protocol.encode(payloadType, payload, msgId));
            } catch (e) {
                onError();
            }
        } else {
            onError();
        }
    }

    public sendCommandWithPayloadtype (payloadType: number, payload: Object): JQueryPromise<IMessageWOMsgId> {
        var def = $.Deferred<IMessageWOMsgId>();

        this.sendMultiresponseCommand(
            payloadType,
            payload,
            result => {
                if (this.isError(result.payloadType)) {
                    def.reject(result);
                } else {
                    def.resolve(result);
                }
                return true;
            },
            () => {
                def.reject();
            }
        );

        return def.promise();
    }
    
    public sendGuaranteedCommandWithPayloadtype (payloadType: number, payload: Object): JQueryPromise<IMessageWOMsgId> {
        if (this.isConnected()) {
            return this.sendCommandWithPayloadtype(payloadType, payload);
        } else {
            var def = $.Deferred();

            this.callbacksOnConnect.push(() => {
                this.sendCommandWithPayloadtype(payloadType, payload)
                    .then(def.resolve, def.reject);
            });

            return def;
        }
    }

    public onConnect() {}

    public onEnd(e: any) {}
}
