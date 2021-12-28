"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ArraySort {
    constructor() {
        this.run = () => {
            Object.defineProperty(Array.prototype, 'ArraySort', {
                configurable: true,
                writable: true,
                value: function (n) {
                    return Array(Math.ceil(this.length / n)).fill().map((_, i) => this.slice(i * n, i * n + n));
                }
            });
        };
        this.enable = true;
    }
}
exports.default = ArraySort;
