//====================== ====================== ====================== ======================
require("dotenv").config();
/**
 * @description Env
 */
export namespace env {
    export function get(name: string): string { return process.env[name]; }
}