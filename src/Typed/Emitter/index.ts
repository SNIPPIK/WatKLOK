import { EventEmitter } from "events";

declare type ListenerSignature<L> = {
    [E in keyof L]: (...args: any[]) => any;
};

declare type DefaultListener = {
    [k: string]: (...args: any[]) => any;
};

export class TypedEmitter<L extends ListenerSignature<L> = DefaultListener> extends EventEmitter {
    // @ts-ignore
    addListener<U extends keyof L>(event: U, listener: L[U] ): this;
    // @ts-ignore
    prependListener<U extends keyof L>(event: U, listener: L[U]): this;
    // @ts-ignore
    prependOnceListener<U extends keyof L>(event: U, listener: L[U]): this;
    // @ts-ignore
    removeListener<U extends keyof L>(event: U, listener: L[U]): this;
    // @ts-ignore
    removeAllListeners(event?: keyof L): this;
    // @ts-ignore
    once<U extends keyof L>(event: U, listener: L[U]): this;
    // @ts-ignore
    on<U extends keyof L>(event: U, listener: L[U]): this;
    // @ts-ignore
    off<U extends keyof L>(event: U, listener: L[U]): this;
    // @ts-ignore
    emit<U extends keyof L>(event: U, ...args: Parameters<L[U]>): boolean;
    // @ts-ignore
    eventNames(): (keyof L)[];
    // @ts-ignore
    listenerCount(type: keyof L): number;
    // @ts-ignore
    listeners<U extends keyof L>(type: U): L[U][];
    // @ts-ignore
    rawListeners<U extends keyof L>(type: U): L[U][];
}