require("dotenv").config();

export namespace env {
    export function get(name: string): string { return process.env[name]; }
}